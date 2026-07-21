import type duckdb from "duckdb";
import { describe, expect, it, vi } from "vitest";
import type { Observation } from "@vitana/shared";
import { insertObservationRows } from "../storage/duckdbRows.js";

describe("insertObservationRows", () => {
  it("uses bounded 500-row JSON batches for dense observations", async () => {
    const run = vi.fn((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error | null) => void;
      callback(null);
    });
    const connection = { run } as unknown as duckdb.Connection;
    const observations = Array.from({ length: 501 }, (_, index) => observation(index));

    await insertObservationRows(connection, observations, 100);

    expect(run).toHaveBeenCalledTimes(2);
    expect(JSON.parse(run.mock.calls[0][1] as string)).toHaveLength(500);
    expect(JSON.parse(run.mock.calls[1][1] as string)).toHaveLength(1);
    expect(JSON.parse(run.mock.calls[0][1] as string)[0].ordinal).toBe(100);
    expect(JSON.parse(run.mock.calls[1][1] as string)[0].ordinal).toBe(600);
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