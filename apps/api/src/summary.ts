import type {
  HealthDataDetail,
  HealthDataDetailEntry,
  HealthDataSummary,
  HealthDataSummarySourceCounts,
  HealthDataSummaryTypeRow,
  HealthStoreData,
  MeasurementType
} from "@vitana/shared";
import {
  classifyValueWithRange,
  getPreferredUnit,
  resolveReferenceRange,
  toPreferredMeasurementValue
} from "@vitana/shared";

const categoryLabels: Record<HealthDataSummaryTypeRow["category"], string> = {
  activity: "Activity",
  cardio: "Cardio",
  sleep: "Sleep",
  body: "Body",
  lab: "Lab",
  derived: "Derived",
  uncategorized: "Uncategorized"
};

export interface MeasurementDetailPage {
  offset: number;
  limit: number;
}

export function summarizeStoreData(store: HealthStoreData): HealthDataSummary {
  const measurementTypes = new Map(store.measurementTypes.map((item) => [item.code, item]));
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

  if (store.activitySessions.length > 0) {
    const row = ensureRow(rows, measurementTypes, "activity_sessions");
    row.displayName = "Activity sessions";
    row.category = "activity";
    for (const session of store.activitySessions) {
      row.counts.activities += 1;
      row.counts.total += 1;
      row.lastMeasuredAt = latestTimestamp(row.lastMeasuredAt, session.endAt ?? session.startAt);
    }
  }

  return summarizeSummaryRows([...rows.values()]);
}

export function summarizeSummaryRows(rows: HealthDataSummaryTypeRow[]): HealthDataSummary {
  const grouped = new Map<HealthDataSummaryTypeRow["category"], HealthDataSummaryTypeRow[]>();
  for (const row of rows) {
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
          acc.activities += row.counts.activities;
          acc.total += row.counts.total;
          acc.types += 1;
          return acc;
        },
        { observations: 0, samples: 0, activities: 0, total: 0, types: 0 }
      ),
      rows: categoryRows
    }));

  const totals = categories.reduce(
    (acc, category) => {
      acc.observations += category.counts.observations;
      acc.samples += category.counts.samples;
      acc.activities += category.counts.activities;
      acc.total += category.counts.total;
      acc.types += category.counts.types;
      return acc;
    },
    { observations: 0, samples: 0, activities: 0, total: 0, types: 0 }
  );

  return {
    generatedAt: new Date().toISOString(),
    totals,
    categories
  };
}

export function listHealthDataDetailEntries(store: HealthStoreData, measurementCode: string): HealthDataDetailEntry[] {
  const measurementTypes = new Map(store.measurementTypes.map((item) => [item.code, item]));
  const dataSources = new Map(store.dataSources.map((item) => [item.id, item]));
  const sourceImports = new Map(store.sourceImports.map((item) => [item.id, item]));
  const observationGroups = new Map(store.observationGroups.map((item) => [item.id, item]));
  const displayName = measurementTypes.get(measurementCode)?.display ?? humanizeCode(measurementCode);

  const observationEntries = store.observations
    .filter((entry) => entry.measurementCode === measurementCode)
    .map<HealthDataDetailEntry>((entry) => {
      const source = dataSources.get(entry.sourceId);
      const imported = source?.importId ? sourceImports.get(source.importId) : undefined;
      const type = measurementTypes.get(entry.measurementCode);
      const group = entry.observationGroupId ? observationGroups.get(entry.observationGroupId) : undefined;
      const display = type ? toPreferredMeasurementValue(entry.value, entry.unit, type, store.profile.units) : entry;
      const referenceRange = type ? resolveReferenceRange(
        type,
        display.unit,
        store.personalReferenceRanges.find((range) => range.measurementCode === entry.measurementCode),
        store.profile.subjectKind
      ).effective : undefined;
      return {
        kind: "observation",
        id: entry.id,
        measurementCode: entry.measurementCode,
        displayName,
        timestamp: entry.observedAt,
        value: display.value,
        unit: display.unit,
        sourceLabel: source?.label,
        sourceKind: source?.sourceKind,
        importFileName: imported?.fileName,
        importedAt: imported?.importedAt,
        note: entry.note,
        observationGroup: group
          ? { id: group.id, kind: group.kind, label: group.label, collectedAt: group.collectedAt }
          : undefined,
        referenceRange,
        status: classifyValueWithRange(entry.value, referenceRange),
        canDelete: true,
        deleteLabel: "Delete"
      };
    });

  const sampleEntries = store.timeSeriesSamples
    .filter((entry) => entry.measurementCode === measurementCode)
    .map<HealthDataDetailEntry>((entry) => {
      const source = dataSources.get(entry.sourceId);
      const imported = source?.importId ? sourceImports.get(source.importId) : undefined;
      const type = measurementTypes.get(entry.measurementCode);
      const display = type ? toPreferredMeasurementValue(entry.value, entry.unit, type, store.profile.units) : entry;
      const referenceRange = type ? resolveReferenceRange(
        type,
        display.unit,
        store.personalReferenceRanges.find((range) => range.measurementCode === entry.measurementCode),
        store.profile.subjectKind
      ).effective : undefined;
      return {
        kind: "sample",
        id: entry.id,
        measurementCode: entry.measurementCode,
        displayName,
        timestamp: entry.endAt || entry.startAt,
        value: display.value,
        unit: display.unit,
        sourceLabel: source?.label,
        sourceKind: source?.sourceKind,
        importFileName: imported?.fileName,
        importedAt: imported?.importedAt,
        note: entry.startAt && entry.endAt && entry.startAt !== entry.endAt ? `${entry.startAt} → ${entry.endAt}` : undefined,
        referenceRange,
        status: classifyValueWithRange(entry.value, referenceRange)
      };
    });

  const activityEntries =
    measurementCode === "activity_sessions"
      ? store.activitySessions.map<HealthDataDetailEntry>((entry) => {
          const source = dataSources.get(entry.sourceId);
          const imported = source?.importId ? sourceImports.get(source.importId) : undefined;
          const endTimestamp = entry.endAt ?? entry.startAt;
          const durationMinutes =
            entry.durationMinutes ?? Math.max(0, Math.round((new Date(endTimestamp).getTime() - new Date(entry.startAt).getTime()) / 60_000));
          const detailNotes = [
            `Type: ${entry.activityType}`,
            entry.energyKcal !== undefined ? `Energy: ${entry.energyKcal.toFixed(1)} kcal` : undefined,
            entry.distanceMeters !== undefined ? `Distance: ${entry.distanceMeters.toFixed(1)} m` : undefined
          ].filter(Boolean);
          return {
            kind: "activity",
            id: entry.id,
            measurementCode,
            displayName,
            timestamp: endTimestamp,
            value: durationMinutes,
            unit: "min",
            sourceLabel: source?.label,
            sourceKind: source?.sourceKind,
            importFileName: imported?.fileName,
            importedAt: imported?.importedAt,
            note: detailNotes.join(" • ")
          };
        })
      : [];

  return [...observationEntries, ...sampleEntries, ...activityEntries].sort((a, b) => {
    const timestampCompare = b.timestamp.localeCompare(a.timestamp);
    if (timestampCompare !== 0) {
      return timestampCompare;
    }
    const nameCompare = a.displayName.localeCompare(b.displayName);
    return nameCompare !== 0 ? nameCompare : a.id.localeCompare(b.id);
  });
}

export function summarizeMeasurementDetail(store: HealthStoreData, measurementCode: string): HealthDataDetail {
  const measurementTypes = new Map(store.measurementTypes.map((item) => [item.code, item]));
  const entries = listHealthDataDetailEntries(store, measurementCode);
  const type = measurementTypes.get(measurementCode);
  return summarizeMeasurementEntries(measurementCode, type, entries, {
    referenceRange: type
      ? resolveReferenceRange(
          type,
          getPreferredUnit(type, store.profile.units),
          store.personalReferenceRanges.find((range) => range.measurementCode === measurementCode),
          store.profile.subjectKind
        )
      : { source: "none" }
  });
}

export function summarizeMeasurementEntries(
  measurementCode: string,
  type: MeasurementType | undefined,
  entries: HealthDataDetailEntry[],
  options: {
    counts?: HealthDataSummarySourceCounts & { total: number };
    latestTimestamp?: string;
    pagination?: HealthDataDetail["pagination"];
    referenceRange?: HealthDataDetail["referenceRange"];
  } = {}
): HealthDataDetail {
  const entryCounts = entries.reduce<HealthDataSummarySourceCounts & { total: number }>(
    (acc, entry) => {
      if (entry.kind === "observation") {
        acc.observations += 1;
      } else if (entry.kind === "sample") {
        acc.samples += 1;
      } else {
        acc.activities += 1;
      }
      acc.total += 1;
      return acc;
    },
    { observations: 0, samples: 0, activities: 0, total: 0 }
  );
  const counts = options.counts ?? entryCounts;

  const latestTimestamp = options.latestTimestamp ?? entries[0]?.timestamp;
  const measurement: HealthDataSummaryTypeRow = {
    code: measurementCode,
    displayName: type?.display ?? entries[0]?.displayName ?? humanizeCode(measurementCode),
    description: type?.description,
    category: type?.category ?? "uncategorized",
    counts,
    lastMeasuredAt: latestTimestamp
  };

  const chartPoints = chartPointsForEntries(entries);

  return {
    generatedAt: new Date().toISOString(),
    measurement,
    referenceRange: options.referenceRange ?? { source: "none" },
    entries,
    chartPoints,
    counts,
    deletion: {
      observationEntries: counts.observations,
      deletableEntries: counts.observations
    },
    pagination: options.pagination ?? {
      limit: entries.length,
      loaded: entries.length,
      total: counts.total,
      hasMore: false
    }
  };
}

export function chartPointsForEntries(entries: HealthDataDetailEntry[]): HealthDataDetail["chartPoints"] {
  return [...entries]
    .filter((entry) => entry.timestamp)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id))
    .map((entry) => ({
      kind: entry.kind,
      timestamp: entry.timestamp,
      value: entry.value,
      unit: entry.unit,
      referenceRange: entry.referenceRange
    }));
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
    description: type?.description,
    category: type?.category ?? "uncategorized",
    counts: {
      observations: 0,
      samples: 0,
      activities: 0,
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
