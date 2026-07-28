import { describe, expect, it } from "vitest";
import { replicaEntities } from "../storage/duckdbReplicaSync.js";
import { createDuckDbHealthStoreFixture } from "./support/duckdbFixture.js";

describe("DuckDB companion replica export", () => {
  it("excludes heart rate readings and keeps all other measurements", () => {
    const data = createDuckDbHealthStoreFixture();
    data.observations.push(
      { id: "heart-rate-old", measurementCode: "heart_rate", observedAt: "2026-06-30T11:59:59.999Z", value: 60, unit: "bpm", sourceId: "source-1" },
      { id: "heart-rate-boundary", measurementCode: "heart_rate", observedAt: "2026-06-30T12:00:00.000Z", value: 61, unit: "bpm", sourceId: "source-1" }
    );
    data.timeSeriesSamples.push(
      { id: "heart-rate-sample-old", measurementCode: "heart_rate", startAt: "2026-06-30T11:58:00.000Z", endAt: "2026-06-30T11:59:59.999Z", value: 62, unit: "bpm", sourceId: "source-1" },
      { id: "heart-rate-sample-recent", measurementCode: "heart_rate", startAt: "2026-07-30T11:58:00.000Z", endAt: "2026-07-30T12:00:00.000Z", value: 63, unit: "bpm", sourceId: "source-1" }
    );

    const entities = replicaEntities(data);
    const entityIds = new Set(entities.map((entity) => entity.entityId));

    expect(entityIds).not.toContain("heart-rate-old");
    expect(entityIds).not.toContain("heart-rate-sample-old");
    expect(entityIds).not.toContain("heart-rate-boundary");
    expect(entityIds).not.toContain("heart-rate-sample-recent");
    expect(entityIds).toContain("observation-z");
    expect(entityIds).toContain("sample-1");
  });

  it("includes Care records in the replica entity stream", () => {
    const data = createDuckDbHealthStoreFixture();
    const healthEvents = [{
      id: "event-1",
      kind: "visit" as const,
      status: "completed" as const,
      occurredAt: "2026-07-20T10:00:00.000Z",
      source: "manual-entry" as const,
      provider: "Local clinic"
    }];
    const careItems = [{
      id: "care-1",
      kind: "follow-up",
      title: "Book follow-up",
      dueStart: "2026-08-01",
      priority: "normal" as const,
      status: "open" as const
    }];
    data.healthEvents = healthEvents;
    data.careItems = careItems;

    expect(replicaEntities(data)).toEqual(expect.arrayContaining([
      {
        entityType: "health-event",
        entityId: "event-1",
        payload: healthEvents[0]
      },
      {
        entityType: "care-item",
        entityId: "care-1",
        payload: careItems[0]
      }
    ]));
  });
});