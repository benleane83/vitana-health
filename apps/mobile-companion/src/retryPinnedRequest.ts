/**
 * Thin companion-side adapter over the shared retry policy. Classification rules and the jittered
 * backoff schedule live in `@vitana/shared` so the sync engine and the pinned-request helpers
 * cannot drift apart - which is exactly what happened when each kept its own regex.
 */
import {
  defaultNetworkRetryPolicy,
  isRetryableNetworkError,
  retryNetworkRequest
} from "@vitana/shared";

export { isRetryableNetworkError as isRetryablePinnedNetworkError };

export async function retryPinnedRequest<T>(
  request: () => Promise<T>,
  options: {
    maxAttempts?: number;
    sleep?: (milliseconds: number) => Promise<void>;
    random?: () => number;
    signal?: { aborted: boolean };
  } = {}
): Promise<T> {
  return retryNetworkRequest(request, {
    policy: {
      ...defaultNetworkRetryPolicy,
      maxAttempts: options.maxAttempts ?? defaultNetworkRetryPolicy.maxAttempts
    },
    sleep: options.sleep,
    random: options.random,
    signal: options.signal
  });
}