import type { MeasurementType } from "@vitana/shared";

export function mergeDefaultMeasurementType(
  existing: MeasurementType,
  defaults: MeasurementType
): MeasurementType {
  let changed = false;
  const merged = { ...existing } as MeasurementType;
  const mergedRecord = merged as unknown as Record<string, unknown>;

  for (const [key, value] of Object.entries(defaults)) {
    if (mergedRecord[key] === undefined || (key === "description" && mergedRecord[key] === "")) {
      mergedRecord[key] = value;
      changed = true;
    }
  }

  for (const key of ["preferredUnits", "unitAliases"] as const) {
    const stored = existing[key];
    const fallback = defaults[key];
    if (!stored || !fallback) continue;
    const supplemented = { ...fallback, ...stored };
    if (Object.keys(supplemented).length !== Object.keys(stored).length) {
      mergedRecord[key] = supplemented;
      changed = true;
    }
  }

  return changed ? merged : existing;
}
