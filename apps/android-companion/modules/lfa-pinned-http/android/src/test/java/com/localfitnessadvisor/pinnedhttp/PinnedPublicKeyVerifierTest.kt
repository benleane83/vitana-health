package com.localfitnessadvisor.pinnedhttp

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PinnedPublicKeyVerifierTest {
  private val publicKey = "test-public-key".toByteArray()
  private val matchingHash = "aYm8XQm7xD3B1bEyebANsDEHR0h4d7TMZofm3jJStPw="

  @Test
  fun `accepts the scanned public-key hash`() {
    assertTrue(PinnedPublicKeyVerifier.matches(publicKey, matchingHash))
  }

  @Test
  fun `rejects a different public-key hash`() {
    assertFalse(PinnedPublicKeyVerifier.matches(publicKey, "R6a3M6p3QY4R7wkX3QQuqUEJzpNWQHBG3uMK7z0pCbM="))
  }
}