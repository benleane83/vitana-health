import {
  replicaHandshakeSchema,
  replicaPageSchema,
  type ReplicaHandshake,
  type ReplicaPage
} from "@vitana/shared";
import type { ConnectionDetails } from "../endpointStore";
import { DEFAULT_PINNED_REQUEST_TIMEOUT_MS, pinnedFetch } from "../pinnedFetch";

export interface ReplicaNetwork {
  get(path: string): Promise<unknown>;
}

export function createReplicaNetwork(
  connection: ConnectionDetails,
  timeoutMs = DEFAULT_PINNED_REQUEST_TIMEOUT_MS
): ReplicaNetwork {
  if (!connection.token) throw new Error("A paired companion token is required.");
  const baseUrl = connection.url.replace(/\/+$/, "");
  return {
    async get(path) {
      const response = await pinnedFetch(`${baseUrl}${path}`, connection.publicKeyHash, {
        headers: {
          Accept: "application/json",
          "x-companion-token": connection.token!
        },
        timeoutMs
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof (body as Record<string, unknown>).error === "string"
          ? String((body as Record<string, unknown>).error)
          : `Replica sync failed with status ${response.status}.`;
        throw Object.assign(new Error(message), { status: response.status });
      }
      return body;
    }
  };
}

export class ReplicaClient {
  constructor(private readonly network: ReplicaNetwork) {}

  async handshake(): Promise<ReplicaHandshake> {
    return replicaHandshakeSchema.parse(await this.network.get("/api/companion/sync/handshake"));
  }

  async snapshot(cursor?: string): Promise<ReplicaPage> {
    return replicaPageSchema.parse(await this.network.get(pagePath("/api/companion/sync/snapshot", cursor)));
  }

  async deltas(afterSequence: number, cursor?: string): Promise<ReplicaPage> {
    const path = cursor
      ? pagePath("/api/companion/sync/deltas", cursor)
      : `/api/companion/sync/deltas?afterSequence=${afterSequence}`;
    return replicaPageSchema.parse(await this.network.get(path));
  }
}

function pagePath(path: string, cursor?: string): string {
  return cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path;
}

