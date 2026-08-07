import { describe, expect, it } from "vitest";
import { journalFromSnapshot } from "./journalProjection";

describe("journalFromSnapshot", () => {
  it("groups replica data by local day and paginates newest first", () => {
    const result = journalFromSnapshot(
      { timezone: "America/Los_Angeles", dayLimit: 1 },
      {
        activities: [{
          id: "walk",
          sourceId: "watch",
          activityType: "walking",
          startAt: "2026-08-02T00:30:00.000Z",
          endAt: "2026-08-02T01:00:00.000Z",
          durationMinutes: 30
        }],
        dataSources: [{ id: "watch", sourceKind: "health-connect", label: "Watch", createdAt: "2026-08-01T00:00:00.000Z" }],
        healthEvents: [],
        measurementTypes: [{
          code: "steps",
          display: "Steps",
          description: "Daily steps",
          category: "activity",
          kind: "point",
          canonicalUnit: "count",
          aliases: [],
          aggregation: "sum"
        }],
        observations: [
          { id: "steps-1", measurementCode: "steps", sourceId: "watch", observedAt: "2026-08-02T01:30:00.000Z", value: 120, unit: "count" },
          { id: "steps-2", measurementCode: "steps", sourceId: "watch", observedAt: "2026-08-03T08:00:00.000Z", value: 250, unit: "count" }
        ],
        samples: []
      }
    );

    expect(result.days).toHaveLength(1);
    expect(result.days[0]).toMatchObject({ date: "2026-08-03", summary: { steps: { value: 250, unit: "count", sources: ["Watch"] } } });
    expect(result.nextBeforeDate).toBe("2026-08-03");
  });
});