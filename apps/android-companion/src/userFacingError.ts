import { ApiError } from "@vitana/api-client";

export function userFacingError(caught: unknown, fallback: string): string {
  if (caught instanceof ApiError) {
    if (caught.status === 401 || caught.status === 403) {
      return "Your pairing is no longer valid. Pair this phone with your PC again.";
    }
    if (caught.status === 429) {
      return "Too many requests were sent. Wait a moment, then try again.";
    }
    if (caught.status >= 500) {
      return caught.status === 503
        ? "Your paired PC is completing maintenance. Try again shortly."
        : "Your paired PC could not complete the request. Try again.";
    }
  }

  if (!(caught instanceof Error) || !caught.message.trim()) return fallback;
  const message = caught.message.trim();
  if (
    /https?:\/\//i.test(message) ||
    /\b(?:java|javax|okhttp3)\./i.test(message) ||
    /\b(?:IOException|SocketException|UnknownHostException|SyntaxError)\b/i.test(message) ||
    /(?:unexpected token|JSON parse|network request failed|failed to fetch)/i.test(message)
  ) {
    return fallback;
  }
  return message;
}
