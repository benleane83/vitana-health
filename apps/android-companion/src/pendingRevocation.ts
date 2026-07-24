import {
  clearPendingRevocation,
  loadPendingRevocation,
  savePendingRevocation,
  type ConnectionDetails
} from "./endpointStore";
import { pinnedFetch } from "./pinnedFetch";

export async function queueConnectionRevocation(
  connection: Pick<ConnectionDetails, "url" | "token" | "publicKeyHash">
): Promise<void> {
  if (!connection.token) return;
  await savePendingRevocation({
    url: connection.url,
    token: connection.token,
    publicKeyHash: connection.publicKeyHash
  });
}

export async function retryPendingRevocation(): Promise<void> {
  const pending = await loadPendingRevocation();
  if (!pending?.token) return;
  const response = await pinnedFetch(
    `${pending.url.replace(/\/+$/, "")}/api/pairing/revoke-self`,
    pending.publicKeyHash,
    {
      method: "POST",
      headers: { "x-companion-token": pending.token }
    }
  );
  if (!response.ok && ![401, 403, 404].includes(response.status)) {
    throw new Error("The paired PC could not revoke the old connection.");
  }
  await clearPendingRevocation();
}
