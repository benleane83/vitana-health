import { PAIRING_APP } from "@vitana/api-client";

export interface PairingPayload {
  url: string;
  pairingCode: string;
  publicKeyHash: string | null;
}

export function parsePairingPayload(data: string, requireHttps: boolean): PairingPayload {
  const payload = parsePayload(data);
  if (payload.app !== PAIRING_APP) throw new Error("This QR code is not a Vitana pairing code.");
  if (typeof payload.url !== "string" || typeof payload.pairingCode !== "string") {
    throw new Error("This pairing QR code is incomplete. Refresh it in the web app and try again.");
  }
  const url = payload.url.replace(/\/+$/, "");
  if (requireHttps && !url.startsWith("https://")) throw new Error("Production pairing requires HTTPS.");
  if (url.startsWith("https://") && typeof payload.publicKeyHash !== "string") {
    throw new Error("This pairing code does not include a server identity.");
  }
  return {
    url,
    pairingCode: payload.pairingCode,
    publicKeyHash: typeof payload.publicKeyHash === "string" ? payload.publicKeyHash : null
  };
}

function parsePayload(data: string): Record<string, unknown> {
  if (data.startsWith("vitana://")) {
    const link = new URL(data);
    if (link.hostname !== "pair" || (link.pathname !== "" && link.pathname !== "/")) {
      throw new Error("This link is not a Vitana pairing link.");
    }
    return Object.fromEntries(link.searchParams.entries());
  }
  return JSON.parse(data) as Record<string, unknown>;
}
