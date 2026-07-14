package com.localfitnessadvisor.pinnedhttp

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

class LfaPinnedHttpModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LfaPinnedHttp")

    AsyncFunction("request") {
      url: String,
      method: String,
      headers: Map<String, String>,
      body: String?,
      publicKeyHash: String ->
      val trustManager = object : X509TrustManager {
        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
        override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) = Unit
        override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
          val certificate = chain.firstOrNull() ?: throw java.security.cert.CertificateException("Server sent no certificate.")
          if (!PinnedPublicKeyVerifier.matches(certificate.publicKey.encoded, publicKeyHash)) {
            throw java.security.cert.CertificateException("Server identity did not match the scanned QR code.")
          }
        }
      }
      val sslContext = SSLContext.getInstance("TLS")
      sslContext.init(null, arrayOf(trustManager), SecureRandom())
      val client = OkHttpClient.Builder()
        .sslSocketFactory(sslContext.socketFactory, trustManager)
        .connectTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(90, TimeUnit.SECONDS)
        .readTimeout(180, TimeUnit.SECONDS)
        .callTimeout(210, TimeUnit.SECONDS)
        // The QR-pinned key is the server identity and remains valid when its private LAN address changes.
        .hostnameVerifier { _, _ -> true }
        .build()
      val requestBuilder = Request.Builder().url(url)
      headers.forEach { (name, value) -> requestBuilder.header(name, value) }
      val requestBody = body?.toRequestBody(headers["Content-Type"]?.toMediaTypeOrNull())
      requestBuilder.method(method.uppercase(), requestBody)
      try {
        client.newCall(requestBuilder.build()).execute().use { response ->
          mapOf(
            "status" to response.code,
            "body" to (response.body?.string() ?: ""),
            "headers" to response.headers.toMultimap().mapValues { it.value.joinToString(", ") }
          )
        }
      } catch (error: SocketTimeoutException) {
        throw Exception("Pinned HTTPS request timed out while waiting for the API response. URL: $url")
      } catch (error: UnknownHostException) {
        throw Exception("Pinned HTTPS request failed because the API host could not be resolved. URL: $url")
      } catch (error: ConnectException) {
        throw Exception("Pinned HTTPS request could not connect to the API. Verify the server is running and reachable on your LAN. URL: $url")
      } catch (error: IOException) {
        throw Exception("Pinned HTTPS request failed due to a network I/O error: ${error.message ?: "unknown error"}. URL: $url")
      }
    }
  }
}
