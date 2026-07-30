import type duckdb from "duckdb";
import { describe, expect, it, vi } from "vitest";
import type { Observation } from "@vitana/shared";
import { insertObservationRows } from "../storage/duckdbRows.js";

describe("insertObservationRows", () => {
  it("uses bounded scalar batches for dense observations", async () => {
    const all = insertStub();
    const connection = { all } as unknown as duckdb.Connection;
    const observations = Array.from({ length: 501 }, (_, index) => observation(index));

    await insertObservationRows(connection, observations, 100);

    expect(all).toHaveBeenCalledTimes(3);
    expect(all.mock.calls[0][0]).not.toContain("json_each");
    expect(all.mock.calls[0]).toHaveLength(15 * 200 + 2);
    expect(all.mock.calls[1]).toHaveLength(15 * 200 + 2);
    expect(all.mock.calls[2]).toHaveLength(15 * 101 + 2);
    expect(all.mock.calls[0][1]).toBe(100);
    expect(all.mock.calls[2][1]).toBe(500);
  });

  it("reports only the rows the insert actually wrote", async () => {
    const all = insertStub([{ id: "heart-rate-1" }]);
    const connection = { all } as unknown as duckdb.Connection;

    const result = await insertObservationRows(
      connection, [observation(0), observation(1)], 0);

    expect(result.accepted).toHaveLength(2);
    expect(result.inserted.map((entry) => entry.id)).toEqual(["heart-rate-1"]);
  });

  it("canonicalizes units and rejects rows the registry cannot convert", async () => {
    const all = insertStub();
    const connection = { all } as unknown as duckdb.Connection;

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

/** Observation inserts use `RETURNING id`, so they run through `all` rather than `run`. */
function insertStub(rows: Array<{ id: string }> = []) {
  return vi.fn((...args: unknown[]) => {
    const callback = args.at(-1) as (error: Error | null, rows: unknown[]) => void;
    callback(null, rows);
  });
}

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