/**
 * Single source of truth for "is this network failure worth retrying, and how long should we wait".
 *
 * The phone previously carried two independently drifting copies of a message-matching regex. The
 * native layer now returns structured codes, so classification is a set lookup with the regex kept
 * only as a fallback for errors raised before the native module is reached (plain-HTTP dev builds,
 * fetch polyfills).
 */
import {
  isPinnedHttpErrorCode,
  retryablePinnedHttpErrorCodes,
  type PinnedHttpErrorCode
} from "./pinnedHttp.js";

/**
 * Derived from the transport contract rather than restated, so adding a code there cannot leave
 * this list behind - which previously meant an unclassified failure silently became non-retryable.
 */
export const retryableNetworkErrorCodes = retryablePinnedHttpErrorCodes;

export type RetryableNetworkErrorCode = PinnedHttpErrorCode;

const retryableCodes = new Set<string>(retryableNetworkErrorCodes);

/** Errors raised outside the native module still only carry a message. */
const retryableMessagePattern =
  /network i\/o error|timed out|could not connect|could not find|connection (?:abort|reset)|interrupted/i;

export function networkErrorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" ? code : undefined;
}

export function isRetryableNetworkError(error: unknown): boolean {
  const code = networkErrorCode(error);
  // Only a code the transport contract knows about is authoritative. An unrecognised one - a
  // library's own code, or a native build newer than this bundle - falls through to the message
  // check rather than being silently treated as fatal.
  if (code && isPinnedHttpErrorCode(code)) return retryableCodes.has(code);
  if (isAbortError(error)) return false;
  const message = error instanceof Error ? error.message : String(error);
  return retryableMessagePattern.test(message);
}

export function isAbortError(error: unknown): boolean {
  if (networkErrorCode(error) === "cancelled") return true;
  return error instanceof Error && (error.name === "AbortError" || error.message === "Aborted");
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const defaultNetworkRetryPolicy: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 15_000
};

/**
 * Exponential backoff with full jitter. Jitter matters here because a resumed sync retries every
 * outstanding chunk, and a fixed schedule would march them into the PC in lockstep.
 */
export function retryDelayMs(
  attempt: number,
  policy: RetryPolicy = defaultNetworkRetryPolicy,
  random: () => number = Math.random
): number {
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(ceiling * random());
}

export interface RetryOptions {
  policy?: RetryPolicy;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  signal?: { aborted: boolean };
  isRetryable?: (error: unknown) => boolean;
}

export async function retryNetworkRequest<T>(request: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const policy = options.policy ?? defaultNetworkRetryPolicy;
  const sleep = options.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const isRetryable = options.isRetryable ?? isRetryableNetworkError;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      if (options.signal?.aborted || !isRetryable(error) || attempt === policy.maxAttempts) throw error;
      await sleep(retryDelayMs(attempt, policy, options.random));
    }
  }

  throw new Error("The request could not be completed.");
}
