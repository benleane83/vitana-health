import {
  computeAnalytics,
  convertMeasurementValue,
  defaultMeasurementTypes,
  getPreferredUnit,
  safetyNotice,
  type ClinicianReport,
  type HealthStoreData
} from "@local-fitness-advisor/shared";

export function buildClinicianReport(store: HealthStoreData, generatedAt = new Date().toISOString()): ClinicianReport {
  const analytics = computeAnalytics(store);
  const heightType = defaultMeasurementTypes.find((type) => type.code === "height");
  const heightUnit = heightType ? getPreferredUnit(heightType, store.profile.units) : "cm";
  const height = store.profile.heightCm === undefined || !heightType
    ? undefined
    : { value: convertMeasurementValue(store.profile.heightCm, heightType, "cm", heightUnit) ?? store.profile.heightCm, unit: heightUnit };
  const latestMeasurements = analytics.latestMetrics
    .map((metric) => ({
      displayName: metric.label,
      value: metric.value,
      unit: metric.unit,
      measuredAt: metric.observedAt
    }))
    .sort((a, b) => b.measuredAt.localeCompare(a.measuredAt) || a.displayName.localeCompare(b.displayName));

  const flaggedLabs = analytics.labAlerts
    .map((alert) => ({
      displayName: alert.marker,
      value: alert.value,
      unit: alert.unit,
      flag: alert.flag,
      collectedAt: "",
      referenceRange: alert.reference
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return {
    generatedAt,
    disclaimer: safetyNotice,
    patient: {
      displayName: store.profile.displayName,
      birthYear: store.profile.birthYear,
      sex: store.profile.sex,
      heightCm: store.profile.heightCm,
      units: store.profile.units,
      height
    },
    totals: {
      observations: store.observations.length,
      samples: store.timeSeriesSamples.length,
      activities: store.activitySessions.length
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
