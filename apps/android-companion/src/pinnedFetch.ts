import LfaPinnedHttp from "../modules/lfa-pinned-http/src/LfaPinnedHttpModule";

export interface PinnedResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<Record<string, unknown>>;
}

export async function pinnedFetch(
  url: string,
  publicKeyHash: string | null,
  options: RequestInit = {}
): Promise<PinnedResponse> {
  if (!url.startsWith("https://")) {
    return fetch(url, options);
  }
  if (!publicKeyHash) throw new Error("The connection QR code did not include a server identity.");

  const headers = Object.fromEntries(new Headers(options.headers).entries());
  const result = await LfaPinnedHttp.request(
    url,
    options.method ?? "GET",
    headers,
    typeof options.body === "string" ? options.body : null,
    publicKeyHash
  );
  return {
    ok: result.status >= 200 && result.status < 300,
    status: result.status,
    text: async () => result.body,
    json: async () => JSON.parse(result.body) as Record<string, unknown>
  };
}
