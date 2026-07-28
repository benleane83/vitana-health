const DEFAULT_MAX_ATTEMPTS = 3;

export async function retryPinnedRequest<T>(
  request: () => Promise<T>,
  options: { maxAttempts?: number; sleep?: (milliseconds: number) => Promise<void> } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await request();
    } catch (error) {
      if (!isRetryablePinnedNetworkError(error) || attempt === maxAttempts) throw error;
      await sleep(attempt * 1000);
    }
  }

  throw new Error("The request could not be completed.");
}

export function isRetryablePinnedNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /network i\/o error|timed out|connection timed out|could not connect|connection (?:abort|reset)|interrupted/i.test(message);
}