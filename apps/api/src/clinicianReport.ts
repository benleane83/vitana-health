import { computeAnalytics, safetyNotice, type ClinicianReport, type HealthStoreData } from "@local-fitness-advisor/shared";

function displayName(store: HealthStoreData, code: string): string {
  return store.measurementTypes.find((type) => type.code === code)?.display ?? code.replaceAll("_", " ");
}

function referenceRange(low?: number, high?: number, unit?: string): string | undefined {
  if (low === undefined && high === undefined) return undefined;
  return `${low ?? "—"}–${high ?? "—"}${unit ? ` ${unit}` : ""}`;
}

export function buildClinicianReport(store: HealthStoreData, generatedAt = new Date().toISOString()): ClinicianReport {
  const analytics = computeAnalytics(store);
  const panels = new Map(store.labPanels.map((panel) => [panel.id, panel]));
  const latestMeasurements = analytics.latestMetrics
    .map((metric) => ({
      displayName: metric.label,
      value: metric.value,
      unit: metric.unit,
      measuredAt: metric.observedAt
    }))
    .sort((a, b) => b.measuredAt.localeCompare(a.measuredAt) || a.displayName.localeCompare(b.displayName));

  const flaggedLabs = store.labMarkers
    .filter(
      (marker): marker is typeof marker & { flag: "low" | "high" | "critical" | "unknown" } =>
        Boolean(marker.flag) && marker.flag !== "normal"
    )
    .map((marker) => ({
      displayName: marker.displayName || displayName(store, marker.measurementCode),
      value: marker.value,
      unit: marker.unit,
      flag: marker.flag,
      collectedAt: panels.get(marker.panelId)?.collectedAt ?? "",
      referenceRange: referenceRange(marker.referenceLow, marker.referenceHigh, marker.unit)
    }))
    .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt) || a.displayName.localeCompare(b.displayName));

  return {
    generatedAt,
    disclaimer: safetyNotice,
    patient: {
      displayName: store.profile.displayName,
      birthYear: store.profile.birthYear,
      sex: store.profile.sex,
      heightCm: store.profile.heightCm,
      units: store.profile.units
    },
    totals: {
      observations: store.observations.length,
      samples: store.timeSeriesSamples.length,
      activities: store.activitySessions.length,
      sleepSessions: store.sleepSessions.length,
      labMarkers: store.labMarkers.length
    },
    latestMeasurements,
    flaggedLabs,
    trends: analytics.trendCards.map((trend) => ({
      displayName: trend.label,
      unit: trend.unit,
      direction: trend.direction,
      summary: trend.summary
    })),
    sources: store.sourceImports
      .map((source) => ({
        fileName: source.fileName,
        sourceKind: source.sourceKind,
        importedAt: source.importedAt,
        status: source.status,
        rowCount: source.rowCount
      }))
      .sort((a, b) => b.importedAt.localeCompare(a.importedAt) || a.fileName.localeCompare(b.fileName))
  };
}
