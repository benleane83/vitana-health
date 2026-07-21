import { createApiClient, type ApiTransportResponse } from "@vitana/api-client";
import type { ConnectionDetails } from "./endpointStore";
import { DEFAULT_PINNED_REQUEST_TIMEOUT_MS, pinnedFetch } from "./pinnedFetch";

export function createCompanionApi(connection: ConnectionDetails, timeoutMs = DEFAULT_PINNED_REQUEST_TIMEOUT_MS) {
  const baseUrl = connection.url.replace(/\/+$/, "");
  const token = connection.token;
  if (!token) throw new Error("A paired companion token is required.");
  return createApiClient(async ({ path, method, headers, body }): Promise<ApiTransportResponse> =>
    pinnedFetch(`${baseUrl}${path}`, connection.publicKeyHash, {
      method,
      headers: {
        ...headers,
        "x-companion-token": token
      },
      body,
      timeoutMs
    }));
}
