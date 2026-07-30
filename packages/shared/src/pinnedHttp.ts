/**
 * Platform-neutral contract for the pinned HTTP transport.
 *
 * The phone talks to the PC over TLS whose certificate is not signed by any public CA - the QR
 * code carries a public-key hash and that hash *is* the server's identity. No stock HTTP client
 * does that, so every platform needs its own native implementation: Android has one in Kotlin, and
 * iOS will need one in Swift. This module is what a second implementation has to satisfy, so the
 * port is a checklist rather than an archaeology exercise.
 *
 * The error codes are the important half. A pinning failure and a flaky Wi-Fi hop look identical
 * at the message level, but one is a possible attack that must never be retried and the other is
 * routine. Codes are what let the retry policy tell them apart without pattern-matching prose.
 */

/**
 * Failures the transport is expected to report, and whether retrying could plausibly help.
 *
 * `retryable: false` is a security statement as much as a behavioural one: retrying a pinning
 * failure would hammer whatever is impersonating the PC and might eventually be mistaken for a
 * transient blip by the user.
 */
export const PINNED_HTTP_ERROR_CODES = Object.freeze({
  /** No response within the caller's budget. */
  "network-timeout": { retryable: true },
  /** The host could not be resolved - usually the phone left the LAN. */
  "network-unreachable": { retryable: true },
  /** The host resolved but refused or dropped the connection. */
  "network-connect-failed": { retryable: true },
  /** The connection died mid-transfer. */
  "network-interrupted": { retryable: true },
  /**
   * The server's public key did not match the hash from the QR code. Either the user is pointed at
   * a different PC, or something is impersonating theirs. Never retried, never silently recovered.
   */
  "tls-pinning-failed": { retryable: false },
  /** TLS failed for a reason other than the pin - version mismatch, malformed certificate. */
  "tls-handshake-failed": { retryable: false },
  /** The caller cancelled the request. Not a failure. */
  cancelled: { retryable: false },
  /** This platform has no pinned transport, so the request was never attempted. */
  "platform-unsupported": { retryable: false }
} as const satisfies Record<string, { retryable: boolean }>);

export type PinnedHttpErrorCode = keyof typeof PINNED_HTTP_ERROR_CODES;

export function isPinnedHttpErrorCode(value: unknown): value is PinnedHttpErrorCode {
  return typeof value === "string" && value in PINNED_HTTP_ERROR_CODES;
}

/** Codes an implementation is allowed to report as worth another attempt. */
export const retryablePinnedHttpErrorCodes = Object.freeze(
  (Object.keys(PINNED_HTTP_ERROR_CODES) as PinnedHttpErrorCode[]).filter(
    (code) => PINNED_HTTP_ERROR_CODES[code].retryable
  )
);

/** Bounds every implementation must clamp the caller's timeout into, so none can hang forever. */
export const PINNED_HTTP_TIMEOUT_BOUNDS_MS: Readonly<{ min: number; max: number; default: number }> =
  Object.freeze({ min: 1_000, max: 120_000, default: 15_000 });

export interface PinnedHttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** Text only. Binary uploads are base64-encoded by the caller. */
  body: string | null;
  /** Base64 SHA-256 of the server's SubjectPublicKeyInfo, taken from the pairing QR code. */
  publicKeyHash: string;
  timeoutMs?: number;
  /**
   * Caller-chosen identity for `cancel`. Native clients own their own socket, so dropping the
   * promise does not stop a multi-megabyte upload - only cancelling by id does.
   */
  requestId?: string | null;
}

export interface PinnedHttpResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

/**
 * What a native implementation exposes.
 *
 * Non-2xx responses resolve normally - they are the PC answering, and the caller decides what an
 * HTTP 409 means. Only transport failures reject, and every rejection must carry a
 * `PinnedHttpErrorCode` in its `code` property.
 */
export interface PinnedHttpClient {
  request(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string | null,
    publicKeyHash: string,
    timeoutMs?: number,
    requestId?: string | null
  ): Promise<PinnedHttpResponse>;
  /** Resolves `true` when a call was cancelled, `false` when the id was already finished. */
  cancel(requestId: string): Promise<boolean>;
}
