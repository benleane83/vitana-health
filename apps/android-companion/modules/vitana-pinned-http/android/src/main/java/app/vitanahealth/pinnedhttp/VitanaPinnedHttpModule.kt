package app.vitanahealth.pinnedhttp

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager
import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * Carries a stable machine-readable code alongside the user-facing message so the JS retry policy
 * can decide what is worth retrying without pattern-matching on prose.
 */
private class PinnedHttpException(code: String, message: String) : CodedException(code, message, null)

class VitanaPinnedHttpModule : Module() {
  private data class ClientKey(val publicKeyHash: String, val timeoutMs: Int)

  /** In-flight calls by request id, so JS can cancel a long upload instead of just dropping it. */
  private val calls = ConcurrentHashMap<String, Call>()

  private val clients = object : LinkedHashMap<ClientKey, OkHttpClient>(4, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<ClientKey, OkHttpClient>): Boolean {
      if (size <= 4) return false
      closeClient(eldest.value)
      return true
    }
  }

  override fun definition() = ModuleDefinition {
    Name("VitanaPinnedHttp")

    OnDestroy {
      calls.values.forEach(Call::cancel)
      calls.clear()
      synchronized(clients) {
        clients.values.forEach(::closeClient)
        clients.clear()
      }
    }

    AsyncFunction("cancel") { requestId: String ->
      val call = calls.remove(requestId)
      call?.cancel()
      call != null
    }

    AsyncFunction("request") {
      url: String,
      method: String,
      headers: Map<String, String>,
      body: String?,
      publicKeyHash: String,
      timeoutMs: Int?,
      requestId: String? ->
      val requestTimeoutMs = (timeoutMs ?: 15_000).coerceIn(1_000, 120_000)
      val client = clientFor(publicKeyHash, requestTimeoutMs)
      val requestBuilder = Request.Builder().url(url)
      headers.forEach { (name, value) -> requestBuilder.header(name, value) }
      val requestBody = body?.toRequestBody(headers["Content-Type"]?.toMediaTypeOrNull())
      requestBuilder.method(method.uppercase(), requestBody)
      val call = client.newCall(requestBuilder.build())
      requestId?.let { calls[it] = call }
      try {
        call.execute().use { response ->
          mapOf(
            "status" to response.code,
            "body" to (response.body?.string() ?: ""),
            "headers" to response.headers.toMultimap().mapValues { it.value.joinToString(", ") }
          )
        }
      } catch (error: SocketTimeoutException) {
        throw PinnedHttpException("network-timeout", "The request timed out. Check that your paired PC is awake and reachable, then try again.")
      } catch (error: UnknownHostException) {
        throw PinnedHttpException("network-unreachable", "Could not find your paired PC on the local network. Check its connection and try again.")
      } catch (error: ConnectException) {
        throw PinnedHttpException("network-connect-failed", "Could not connect to your paired PC. Check that it is running and reachable, then try again.")
      } catch (error: IOException) {
        if (call.isCanceled()) {
          throw PinnedHttpException("cancelled", "The request was cancelled.")
        }
        throw PinnedHttpException("network-interrupted", "The connection to your paired PC was interrupted. Check the local network and try again.")
      } finally {
        requestId?.let { calls.remove(it) }
      }
    }
  }

  private fun clientFor(publicKeyHash: String, timeoutMs: Int): OkHttpClient {
    val key = ClientKey(publicKeyHash, timeoutMs)
    synchronized(clients) {
      return clients.getOrPut(key) {
        val trustManager = object : X509TrustManager {
          override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
          override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) = Unit
          override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
            val certificate = chain.firstOrNull()
              ?: throw java.security.cert.CertificateException("Server sent no certificate.")
            if (!PinnedPublicKeyVerifier.matches(certificate.publicKey.encoded, publicKeyHash)) {
              throw java.security.cert.CertificateException("Server identity did not match the scanned QR code.")
            }
          }
        }
        val sslContext = SSLContext.getInstance("TLS")
        sslContext.init(null, arrayOf(trustManager), SecureRandom())
        OkHttpClient.Builder()
          .sslSocketFactory(sslContext.socketFactory, trustManager)
          .connectTimeout(minOf(timeoutMs, 8_000).toLong(), TimeUnit.MILLISECONDS)
          .writeTimeout(timeoutMs.toLong(), TimeUnit.MILLISECONDS)
          .readTimeout(timeoutMs.toLong(), TimeUnit.MILLISECONDS)
          .callTimeout(timeoutMs.toLong(), TimeUnit.MILLISECONDS)
          // The QR-pinned key is the server identity and remains valid when its private LAN address changes.
          .hostnameVerifier { _, _ -> true }
          .build()
      }
    }
  }

  private fun closeClient(client: OkHttpClient) {
    client.dispatcher.executorService.shutdown()
    client.connectionPool.evictAll()
  }
}
