import { createApiClient, type ApiTransportResponse } from "@local-fitness-advisor/api-client";
import type { ConnectionDetails } from "./endpointStore";
import { pinnedFetch } from "./pinnedFetch";

export function createCompanionApi(connection: ConnectionDetails) {
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
      body
    }));
}
