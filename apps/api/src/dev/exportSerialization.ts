/**
 * Serialization shared by the profile export and its companion importer. DuckDB hands back
 * JavaScript values that JSON cannot represent losslessly (BigInt, Buffer, Date), so each is
 * wrapped in a single-key envelope that `reviveValue` reverses exactly.
 */

export interface BigIntEnvelope {
  $bigint: string;
}

export interface Base64Envelope {
  $base64: string;
}

export interface TimestampEnvelope {
  $timestamp: string;
}

export function serializeRow(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(row)) {
    result[column] = serializeValue(value);
  }
  return result;
}

export function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return { $bigint: value.toString() } satisfies BigIntEnvelope;
  if (Buffer.isBuffer(value)) return { $base64: value.toString("base64") } satisfies Base64Envelope;
  if (value instanceof Date) return { $timestamp: value.toISOString() } satisfies TimestampEnvelope;
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof value === "object") return serializeRow(value as Record<string, unknown>);
  return value;
}

export function reviveRow(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(row)) {
    result[column] = reviveValue(value);
  }
  return result;
}

export function reviveValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(reviveValue);
  if (typeof value !== "object") return value;

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 1) {
    const [key, wrapped] = entries[0];
    if (key === "$bigint" && typeof wrapped === "string") return BigInt(wrapped);
    if (key === "$base64" && typeof wrapped === "string") return Buffer.from(wrapped, "base64");
    if (key === "$timestamp" && typeof wrapped === "string") return new Date(wrapped);
  }
  return reviveRow(value as Record<string, unknown>);
}
