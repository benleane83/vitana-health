import { describe, expect, it } from "vitest";
import {
  COMPANION_REPLICA_MAX_PROTOCOL_VERSION,
  COMPANION_REPLICA_MIN_PROTOCOL_VERSION,
  COMPANION_REPLICA_PAGE_SIZE,
  COMPANION_REPLICA_PROTOCOL_VERSION,
  negotiateReplicaProtocolVersion,
  replicaHandshakeSchema,
  replicaPageSchema
} from "../replicaSync.js";

const identity = {
  serverInstanceId: "c65b97ac-ae21-4e39-9bed-1411718f85d6",
  profileId: "profile-1",
  pairingId: "pairing-1"
};

const serverRange = {
  minProtocolVersion: COMPANION_REPLICA_MIN_PROTOCOL_VERSION,
  maxProtocolVersion: COMPANION_REPLICA_MAX_PROTOCOL_VERSION
};

const observationPayload = (id: string) => ({
  id,
  measurementCode: "weight",
  observedAt: "2026-07-25T14:00:00.000Z",
  value: 80,
  unit: "kg",
  sourceId: "source-1"
});

describe("companion replica protocol", () => {
  it("validates a stable versioned handshake and replay-safe page", () => {
    expect(replicaHandshakeSchema.parse({
      protocolVersion: COMPANION_REPLICA_PROTOCOL_VERSION,
      ...serverRange,
      ...identity,
      highWaterMark: { revision: 4, sequence: 9 }
    })).toMatchObject(identity);
    expect(replicaPageSchema.parse({
      protocolVersion: COMPANION_REPLICA_PROTOCOL_VERSION,
      ...identity,
      kind: "delta",
      changes: [
        {
          revision: 4,
          sequence: 9,
          entityType: "health-event",
          entityId: "event-1",
          operation: "upsert",
          payload: { id: "event-1", kind: "other", status: "completed", occurredAt: "2026-07-25", source: "manual-entry" }
        },
        {
          revision: 4,
          sequence: 10,
          entityType: "care-item",
          entityId: "care-1",
          operation: "upsert",
          payload: { id: "care-1", title: "Follow up", kind: "follow-up", priority: "normal", status: "open" }
        }
      ],
      highWaterMark: { revision: 4, sequence: 10 },
      complete: true,
      cachedAt: "2026-07-25T14:00:00.000Z"
    }).changes).toHaveLength(2);
  });

  it("rejects unsupported versions and malformed operations", () => {
    expect(() => replicaHandshakeSchema.parse({
      protocolVersion: COMPANION_REPLICA_MAX_PROTOCOL_VERSION + 1,
      ...serverRange,
      ...identity,
      highWaterMark: { revision: 0, sequence: 0 }
    })).toThrow();
    expect(() => replicaPageSchema.parse({
      protocolVersion: 2,
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

  it("accepts the configured page-size boundary and rejects larger pages", () => {
    const page = {
      protocolVersion: COMPANION_REPLICA_PROTOCOL_VERSION,
      ...identity,
      kind: "snapshot" as const,
      changes: Array.from({ length: COMPANION_REPLICA_PAGE_SIZE }, (_, index) => ({
        revision: 0,
        sequence: index,
        entityType: "observation" as const,
        entityId: `observation-${index}`,
        operation: "upsert" as const,
        payload: observationPayload(`observation-${index}`)
      })),
      highWaterMark: { revision: 0, sequence: 0 },
      complete: false,
      cachedAt: "2026-07-25T14:00:00.000Z"
    };

    expect(replicaPageSchema.parse(page).changes).toHaveLength(COMPANION_REPLICA_PAGE_SIZE);
    expect(() => replicaPageSchema.parse({
      ...page,
      changes: [...page.changes, page.changes[0]]
    })).toThrow(`Array must contain at most ${COMPANION_REPLICA_PAGE_SIZE} element(s)`);
  });

  it("rejects an upsert payload that does not match its entity shape", () => {
    expect(() => replicaPageSchema.parse({
      protocolVersion: COMPANION_REPLICA_PROTOCOL_VERSION,
      ...identity,
      kind: "delta",
      changes: [{
        revision: 1,
        sequence: 1,
        entityType: "observation",
        entityId: "observation-1",
        operation: "upsert",
        payload: { ...observationPayload("observation-1"), value: "eighty" }
      }],
      highWaterMark: { revision: 1, sequence: 1 },
      complete: true,
      cachedAt: "2026-07-25T14:00:00.000Z"
    })).toThrow(/value/);
  });

  it("carries unknown payload fields from a newer peer instead of dropping the change", () => {
    const parsed = replicaPageSchema.parse({
      protocolVersion: COMPANION_REPLICA_PROTOCOL_VERSION,
      ...identity,
      kind: "delta",
      changes: [{
        revision: 1,
        sequence: 1,
        entityType: "observation",
        entityId: "observation-1",
        operation: "upsert",
        payload: { ...observationPayload("observation-1"), fieldFromTheFuture: true }
      }],
      highWaterMark: { revision: 1, sequence: 1 },
      complete: true,
      cachedAt: "2026-07-25T14:00:00.000Z"
    });

    expect(parsed.changes[0].payload).toMatchObject({ fieldFromTheFuture: true });
  });

  describe("version negotiation", () => {
    it("settles on the highest version both peers support", () => {
      expect(negotiateReplicaProtocolVersion({ minProtocolVersion: 1, maxProtocolVersion: 2 }, { minProtocolVersion: 1, maxProtocolVersion: 3 })).toBe(2);
      expect(negotiateReplicaProtocolVersion({ minProtocolVersion: 2, maxProtocolVersion: 5 }, { minProtocolVersion: 1, maxProtocolVersion: 2 })).toBe(2);
    });

    it("refuses when a client is too old for the server", () => {
      expect(negotiateReplicaProtocolVersion({ minProtocolVersion: 1, maxProtocolVersion: 1 }, { minProtocolVersion: 2, maxProtocolVersion: 3 })).toBeUndefined();
    });

    it("refuses when a client is too new for the server", () => {
      expect(negotiateReplicaProtocolVersion({ minProtocolVersion: 4, maxProtocolVersion: 5 }, { minProtocolVersion: 1, maxProtocolVersion: 3 })).toBeUndefined();
    });

    it("defaults the server side to this build's range", () => {
      expect(negotiateReplicaProtocolVersion(serverRange)).toBe(COMPANION_REPLICA_MAX_PROTOCOL_VERSION);
    });
  });
});

