import VitanaPinnedHttp from "../modules/vitana-pinned-http/src/VitanaPinnedHttpModule";

export const DEFAULT_PINNED_REQUEST_TIMEOUT_MS = 15_000;
export const LONG_RUNNING_PINNED_REQUEST_TIMEOUT_MS = 60_000;

export interface PinnedResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<Record<string, unknown>>;
}

export interface PinnedFetchOptions extends RequestInit {
  timeoutMs?: number;
}

export async function pinnedFetch(
  url: string,
  publicKeyHash: string | null,
  options: PinnedFetchOptions = {}
): Promise<PinnedResponse> {
  const { timeoutMs = DEFAULT_PINNED_REQUEST_TIMEOUT_MS, ...requestOptions } = options;
  if (!url.startsWith("https://")) {
    return waitForResponse(fetch(url, requestOptions), timeoutMs);
  }
  if (!publicKeyHash) throw new Error("The connection QR code did not include a server identity.");

  const headers = Object.fromEntries(new Headers(requestOptions.headers).entries());
  const result = await waitForResponse(VitanaPinnedHttp.request(
    url,
    requestOptions.method ?? "GET",
    headers,
    typeof requestOptions.body === "string" ? requestOptions.body : null,
    publicKeyHash,
    timeoutMs
  ), timeoutMs);
  return {
    ok: result.status >= 200 && result.status < 300,
    status: result.status,
    text: async () => result.body,
    json: async () => JSON.parse(result.body) as Record<string, unknown>
  };
}

function waitForResponse<T>(request: Promise<T>, timeoutMs: number): Promise<T> {
  const safeTimeoutMs = Math.min(Math.max(timeoutMs, 1_000), 120_000);
  const timeoutSeconds = Math.ceil(safeTimeoutMs / 1_000);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Connection timed out after ${timeoutSeconds} second${timeoutSeconds === 1 ? "" : "s"}. Check that your paired PC is awake and reachable on your local network, then try again.`));
    }, safeTimeoutMs);
    request.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}
