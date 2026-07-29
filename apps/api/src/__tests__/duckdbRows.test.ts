import type duckdb from "duckdb";
import { describe, expect, it, vi } from "vitest";
import type { Observation } from "@vitana/shared";
import { insertObservationRows } from "../storage/duckdbRows.js";

describe("insertObservationRows", () => {
  it("uses bounded scalar batches for dense observations", async () => {
    const run = vi.fn((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error | null) => void;
      callback(null);
    });
    const connection = { run } as unknown as duckdb.Connection;
    const observations = Array.from({ length: 501 }, (_, index) => observation(index));

    await insertObservationRows(connection, observations, 100);

    expect(run).toHaveBeenCalledTimes(3);
    expect(run.mock.calls[0][0]).not.toContain("json_each");
    expect(run.mock.calls[0]).toHaveLength(15 * 200 + 2);
    expect(run.mock.calls[1]).toHaveLength(15 * 200 + 2);
    expect(run.mock.calls[2]).toHaveLength(15 * 101 + 2);
    expect(run.mock.calls[0][1]).toBe(100);
    expect(run.mock.calls[2][1]).toBe(500);
  });

  it("canonicalizes units and rejects rows the registry cannot convert", async () => {
    const run = vi.fn((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error | null) => void;
      callback(null);
    });
    const connection = { run } as unknown as duckdb.Connection;

    const result = await insertObservationRows(connection, [
      observation(0),
      { ...observation(1), measurementCode: "body_fat_pct", unit: "unknown" },
      { ...observation(2), measurementCode: "manual_grip_comfort", unit: "score" }
    ], 0);

    expect(result.accepted.map((entry) => entry.unit)).toEqual(["beats/min", "score"]);
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0]).toContain("body_fat_pct");
  });
});

function observation(index: number): Observation {
  const observedAt = new Date(Date.UTC(2026, 6, 20, 0, index)).toISOString();
  return {
    id: `heart-rate-${index}`,
    measurementCode: "heart_rate",
    observedAt,
    value: 60 + (index % 20),
    unit: "bpm",
    sourceId: "health-connect-source"
  };
}