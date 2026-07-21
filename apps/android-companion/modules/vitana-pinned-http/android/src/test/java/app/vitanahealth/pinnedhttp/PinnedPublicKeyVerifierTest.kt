package app.vitanahealth.pinnedhttp

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PinnedPublicKeyVerifierTest {
  private val publicKey = "test-public-key".toByteArray()
  private val matchingHash = "yI6AICpNZQhB5IZJtMP1U+SBMbQV22gEdv0NZWMv8rA="

  @Test
  fun `accepts the scanned public-key hash`() {
    assertTrue(PinnedPublicKeyVerifier.matches(publicKey, matchingHash))
  }

  @Test
  fun `rejects a different public-key hash`() {
    assertFalse(PinnedPublicKeyVerifier.matches(publicKey, "R6a3M6p3QY4R7wkX3QQuqUEJzpNWQHBG3uMK7z0pCbM="))
  }
}