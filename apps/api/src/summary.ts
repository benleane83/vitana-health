import type { HealthDataSummary, HealthDataSummaryTypeRow, HealthStoreData, MeasurementType } from "@local-fitness-advisor/shared";

const categoryLabels: Record<HealthDataSummaryTypeRow["category"], string> = {
  activity: "Activity",
  cardio: "Cardio",
  sleep: "Sleep",
  body: "Body",
  lab: "Lab",
  metabolic: "Metabolic",
  derived: "Derived",
  uncategorized: "Uncategorized"
};

export function summarizeStoreData(store: HealthStoreData): HealthDataSummary {
  const measurementTypes = new Map(store.measurementTypes.map((item) => [item.code, item]));
  const panelCollectionById = new Map(store.labPanels.map((panel) => [panel.id, panel.collectedAt]));
  const rows = new Map<string, HealthDataSummaryTypeRow>();

  for (const observation of store.observations) {
    const row = ensureRow(rows, measurementTypes, observation.measurementCode);
    row.counts.observations += 1;
    row.counts.total += 1;
    row.lastMeasuredAt = latestTimestamp(row.lastMeasuredAt, observation.observedAt);
  }

  for (const sample of store.timeSeriesSamples) {
    const row = ensureRow(rows, measurementTypes, sample.measurementCode);
    row.counts.samples += 1;
    row.counts.total += 1;
    row.lastMeasuredAt = latestTimestamp(row.lastMeasuredAt, sample.endAt);
  }

  for (const marker of store.labMarkers) {
    const row = ensureRow(rows, measurementTypes, marker.measurementCode);
    row.counts.labMarkers += 1;
    row.counts.total += 1;
    row.lastMeasuredAt = latestTimestamp(row.lastMeasuredAt, panelCollectionById.get(marker.panelId));
  }

  const grouped = new Map<HealthDataSummaryTypeRow["category"], HealthDataSummaryTypeRow[]>();
  for (const row of rows.values()) {
    const existing = grouped.get(row.category);
    if (existing) {
      existing.push(row);
    } else {
      grouped.set(row.category, [row]);
    }
  }

  const categories = [...grouped.entries()]
    .sort((a, b) => categoryLabels[a[0]].localeCompare(categoryLabels[b[0]]))
    .map(([key, categoryRows]) => ({
      key,
      label: categoryLabels[key],
      counts: categoryRows.reduce(
        (acc, row) => {
          acc.observations += row.counts.observations;
          acc.samples += row.counts.samples;
          acc.labMarkers += row.counts.labMarkers;
          acc.total += row.counts.total;
          acc.types += 1;
          return acc;
        },
        { observations: 0, samples: 0, labMarkers: 0, total: 0, types: 0 }
      ),
      rows: categoryRows
    }));

  const totals = categories.reduce(
    (acc, category) => {
      acc.observations += category.counts.observations;
      acc.samples += category.counts.samples;
      acc.labMarkers += category.counts.labMarkers;
      acc.total += category.counts.total;
      acc.types += category.counts.types;
      return acc;
    },
    { observations: 0, samples: 0, labMarkers: 0, total: 0, types: 0 }
  );

  return {
    generatedAt: new Date().toISOString(),
    totals,
    categories
  };
}

function ensureRow(
  rows: Map<string, HealthDataSummaryTypeRow>,
  types: Map<string, MeasurementType>,
  measurementCode: string
): HealthDataSummaryTypeRow {
  const existing = rows.get(measurementCode);
  if (existing) {
    return existing;
  }
  const type = types.get(measurementCode);
  const next: HealthDataSummaryTypeRow = {
    code: measurementCode,
    displayName: type?.display ?? humanizeCode(measurementCode),
    category: type?.category ?? "uncategorized",
    counts: {
      observations: 0,
      samples: 0,
      labMarkers: 0,
      total: 0
    }
  };
  rows.set(measurementCode, next);
  return next;
}

function latestTimestamp(current: string | undefined, candidate: string | undefined): string | undefined {
  if (!candidate) {
    return current;
  }
  if (!current) {
    return candidate;
  }
  return candidate > current ? candidate : current;
}

function humanizeCode(code: string): string {
  return code
    .replaceAll("_", " ")
    .replace(/\b\w/g, (segment) => segment.toUpperCase());
}
