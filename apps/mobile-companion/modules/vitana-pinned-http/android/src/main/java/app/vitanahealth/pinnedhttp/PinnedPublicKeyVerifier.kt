package app.vitanahealth.pinnedhttp

import java.security.MessageDigest
import java.util.Base64

object PinnedPublicKeyVerifier {
  fun matches(encodedPublicKey: ByteArray, expectedHash: String): Boolean {
    val actualHash = Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(encodedPublicKey))
    return MessageDigest.isEqual(actualHash.toByteArray(Charsets.UTF_8), expectedHash.toByteArray(Charsets.UTF_8))
  }
}