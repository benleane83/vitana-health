import type { HealthConnectCategory, HealthSourceCursors } from "./endpointStore";

export function earliestHealthSourceCursor(
  cursors: HealthSourceCursors,
  categories: readonly HealthConnectCategory[]
): string | null {
  let earliest: string | null = null;
  for (const category of categories) {
    const cursor = cursors[category];
    if (cursor && (!earliest || cursor < earliest)) earliest = cursor;
  }
  return earliest;
}