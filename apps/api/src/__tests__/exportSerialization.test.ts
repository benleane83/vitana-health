import { describe, expect, it } from "vitest";
import { reviveRow, serializeRow } from "../dev/exportSerialization.js";

describe("export serialization", () => {
  it("round-trips the DuckDB value types JSON cannot represent", () => {
    const row = {
      id: "obs-1",
      ordinal: 42n,
      recordedAt: new Date("2026-07-29T07:00:00.000Z"),
      photo: Buffer.from("binary-payload"),
      value: 72.5,
      flagged: true,
      note: null
    };

    const serialized = serializeRow(row);
    expect(serialized).toEqual({
      id: "obs-1",
      ordinal: { $bigint: "42" },
      recordedAt: { $timestamp: "2026-07-29T07:00:00.000Z" },
      photo: { $base64: Buffer.from("binary-payload").toString("base64") },
      value: 72.5,
      flagged: true,
      note: null
    });

    expect(reviveRow(JSON.parse(JSON.stringify(serialized)))).toEqual(row);
  });

  it("recurses through nested structures", () => {
    const row = { diagnostics: { rejected: [{ at: new Date("2026-01-01T00:00:00.000Z"), count: 3n }] } };
    const revived = reviveRow(JSON.parse(JSON.stringify(serializeRow(row))));
    expect(revived).toEqual(row);
  });

  it("leaves ordinary single-key objects untouched", () => {
    const row = { payload: { total: 7 } };
    expect(reviveRow(JSON.parse(JSON.stringify(serializeRow(row))))).toEqual(row);
  });

  it("normalizes undefined to null so column counts stay stable", () => {
    expect(serializeRow({ missing: undefined })).toEqual({ missing: null });
  });
});
