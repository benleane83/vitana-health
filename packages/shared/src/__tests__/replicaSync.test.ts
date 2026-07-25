import { describe, expect, it } from "vitest";
import {
  COMPANION_REPLICA_PROTOCOL_VERSION,
  replicaHandshakeSchema,
  replicaPageSchema
} from "../replicaSync.js";

const identity = {
  serverInstanceId: "c65b97ac-ae21-4e39-9bed-1411718f85d6",
  profileId: "profile-1",
  pairingId: "pairing-1"
};

describe("companion replica protocol", () => {
  it("validates a stable versioned handshake and replay-safe page", () => {
    expect(replicaHandshakeSchema.parse({
      protocolVersion: COMPANION_REPLICA_PROTOCOL_VERSION,
      ...identity,
      highWaterMark: { revision: 4, sequence: 9 }
    })).toMatchObject(identity);
    expect(replicaPageSchema.parse({
      protocolVersion: COMPANION_REPLICA_PROTOCOL_VERSION,
      ...identity,
      kind: "delta",
      changes: [{
        revision: 4,
        sequence: 9,
        entityType: "observation",
        entityId: "observation-1",
        operation: "tombstone"
      }],
      highWaterMark: { revision: 4, sequence: 9 },
      complete: true,
      cachedAt: "2026-07-25T14:00:00.000Z"
    }).changes).toHaveLength(1);
  });

  it("rejects unsupported versions and malformed operations", () => {
    expect(() => replicaHandshakeSchema.parse({
      protocolVersion: 2,
      ...identity,
      highWaterMark: { revision: 0, sequence: 0 }
    })).toThrow();
    expect(() => replicaPageSchema.parse({
      protocolVersion: 1,
      ...identity,
      kind: "delta",
      changes: [{
        revision: 1,
        sequence: 1,
        entityType: "observation",
        entityId: "observation-1",
        operation: "upsert"
      }],
      highWaterMark: { revision: 1, sequence: 1 },
      complete: true,
      cachedAt: "2026-07-25T14:00:00.000Z"
    })).toThrow("Upserts require a payload");
  });
});

