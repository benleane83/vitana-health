import { describe, expect, it } from "vitest";
import { bodyTrendFromObservations, type BodyTrendObservation } from "./bodyTrendProjection";

const units = "metric" as const;

function session(id: string, observedAt: string, values = [30, 20, 3, 60]): BodyTrendObservation[] {
  return ["skeletal_muscle_mass", "fat_mass", "bone_mineral_content", "weight"].map((measurementCode, index) => ({
    id: `${id}-${measurementCode}`,
    measurementCode,
    observationGroupId: id,
    observedAt,
    value: values[index]!,
    unit: "kg",
    sourceLabel: "Body scale"
  }));
}

describe("bodyTrendFromObservations", () => {
  it("keeps complete sessions and assigns their day in the requested timezone", () => {
    const result = bodyTrendFromObservations(
      { range: "all", timezone: "America/Los_Angeles" },
      [
        ...session("complete", "2026-08-02T01:00:00.000Z"),
        ...session("incomplete", "2026-08-03T12:00:00.000Z").slice(0, 2)
      ],
      units,
      new Date("2026-08-06T12:00:00.000Z")
    );

    expect(result.points).toHaveLength(1);
    expect(result.points[0]).toMatchObject({
      sessionId: "complete",
      date: "2026-08-01",
      sourceLabel: "Body scale",
      components: { skeletalMuscleMass: 30, fatMass: 20, boneMineralContent: 3, weight: 60 }
    });
  });

  it("keeps the latest complete session per day and filters the requested range", () => {
    const result = bodyTrendFromObservations(
      { range: "1m", timezone: "UTC" },
      [
        ...session("old", "2026-06-01T08:00:00.000Z"),
        ...session("morning", "2026-08-01T08:00:00.000Z"),
        ...session("evening", "2026-08-01T20:00:00.000Z", [31, 19, 3.1, 59.5])
      ],
      units,
      new Date("2026-08-06T12:00:00.000Z")
    );

    expect(result.points).toHaveLength(1);
    expect(result.points[0]?.sessionId).toBe("evening");
    expect(result.totalPoints).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it("converts all mass components to the profile preference", () => {
    const result = bodyTrendFromObservations(
      { range: "all", timezone: "UTC" },
      session("imperial", "2026-08-01T08:00:00.000Z"),
      "imperial",
      new Date("2026-08-06T12:00:00.000Z")
    );

    expect(result.unit).toBe("lb");
    expect(result.points[0]?.components.skeletalMuscleMass).toBeCloseTo(66.1387, 3);
    expect(result.points[0]?.components.weight).toBeCloseTo(132.277, 3);
  });
});