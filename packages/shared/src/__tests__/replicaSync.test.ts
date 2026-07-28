import { describe, expect, it } from "vitest";
import {
  COMPANION_REPLICA_PAGE_SIZE,
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
      changes: [
        {
          revision: 4,
          sequence: 9,
          entityType: "health-event",
          entityId: "event-1",
          operation: "upsert",
          payload: { id: "event-1", kind: "other", status: "completed", occurredAt: "2026-07-25" }
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
        payload: { id: `observation-${index}` }
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
});

