import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PINNED_HTTP_ERROR_CODES, isPinnedHttpErrorCode } from "../pinnedHttp.js";
import { isAbortError, isRetryableNetworkError } from "../networkRetry.js";

const kotlinModule = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../apps/mobile-companion/modules/vitana-pinned-http/android/src/main/java/app/vitanahealth/pinnedhttp/VitanaPinnedHttpModule.kt",
      import.meta.url
    )
  ),
  "utf8"
);

describe("pinned HTTP transport contract", () => {
  it("never retries a failed certificate pin", () => {
    // The whole point of pinning is that a mismatch is a security event, not a blip. Retrying it
    // would both hammer the impostor and let the failure read as flaky Wi-Fi to the user.
    const pinningFailure = Object.assign(new Error("Identity did not match."), { code: "tls-pinning-failed" });

    expect(PINNED_HTTP_ERROR_CODES["tls-pinning-failed"].retryable).toBe(false);
    expect(isRetryableNetworkError(pinningFailure)).toBe(false);
    expect(isAbortError(pinningFailure)).toBe(false);
  });

  it("falls back to the message when an error carries a code the contract does not define", () => {
    // A native build newer than this bundle must not have its transient failures silently
    // reclassified as fatal just because the code is unrecognised.
    const unknown = Object.assign(new Error("The connection was interrupted."), { code: "some-future-code" });

    expect(isPinnedHttpErrorCode("some-future-code")).toBe(false);
    expect(isRetryableNetworkError(unknown)).toBe(true);
  });

  it("is implemented by the Android module with no undeclared codes", () => {
    // Kotlin cannot import the TypeScript union, so this is the only thing keeping the two halves
    // of the contract from drifting apart.
    const thrown = [...kotlinModule.matchAll(/PinnedHttpException\("([^"]+)"/g)].map((match) => match[1]);

    expect(thrown.length).toBeGreaterThan(0);
    for (const code of thrown) {
      expect(isPinnedHttpErrorCode(code)).toBe(true);
    }
  });
});
