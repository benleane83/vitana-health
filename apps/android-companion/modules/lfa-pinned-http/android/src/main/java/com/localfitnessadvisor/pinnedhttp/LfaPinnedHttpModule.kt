package com.localfitnessadvisor.pinnedhttp

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.X509Certificate
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
          val actual = android.util.Base64.encodeToString(
            MessageDigest.getInstance("SHA-256").digest(certificate.publicKey.encoded),
            android.util.Base64.NO_WRAP
          )
          if (!MessageDigest.isEqual(actual.toByteArray(), publicKeyHash.toByteArray())) {
            throw java.security.cert.CertificateException("Server identity did not match the scanned QR code.")
          }
        }
      }
      val sslContext = SSLContext.getInstance("TLS")
      sslContext.init(null, arrayOf(trustManager), SecureRandom())
      val client = OkHttpClient.Builder()
        .sslSocketFactory(sslContext.socketFactory, trustManager)
        .hostnameVerifier { _, _ -> true }
        .build()
      val requestBuilder = Request.Builder().url(url)
      headers.forEach { (name, value) -> requestBuilder.header(name, value) }
      val requestBody = body?.toRequestBody(headers["Content-Type"]?.toMediaTypeOrNull())
      requestBuilder.method(method.uppercase(), requestBody)
      client.newCall(requestBuilder.build()).execute().use { response ->
        mapOf(
          "status" to response.code,
          "body" to (response.body?.string() ?: ""),
          "headers" to response.headers.toMultimap().mapValues { it.value.joinToString(", ") }
        )
      }
    }
  }
}
