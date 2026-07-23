import {
  convertMeasurementValue,
  defaultMeasurementTypes,
  getPreferredUnit,
  safetyNotice,
  type AnalyticsSummary,
  type ClinicianReport,
  type ClinicianReportLatestMeasurement,
  type Profile,
  type SourceImport
} from "@vitana/shared";

export type ClinicianReportSourceImport = Pick<SourceImport, "fileName" | "sourceKind" | "importedAt" | "status" | "rowCount">;

export interface ClinicianReportInput {
  profile: Profile;
  analytics: AnalyticsSummary;
  sourceImports: ClinicianReportSourceImport[];
  latestMeasurements?: ClinicianReportLatestMeasurement[];
}

export function buildClinicianReport(input: ClinicianReportInput, generatedAt = new Date().toISOString()): ClinicianReport {
  const { profile, analytics, sourceImports } = input;
  const heightType = defaultMeasurementTypes.find((type) => type.code === "height");
  const heightUnit = heightType ? getPreferredUnit(heightType, profile.units) : "cm";
  const height = profile.heightCm === undefined || !heightType
    ? undefined
    : { value: convertMeasurementValue(profile.heightCm, heightType, "cm", heightUnit) ?? profile.heightCm, unit: heightUnit };
  const latestMeasurements = input.latestMeasurements ?? analytics.latestMetrics.map((metric) => ({
    category: "uncategorized" as const,
    displayName: metric.label,
    value: metric.value,
    unit: metric.unit,
    measuredAt: metric.observedAt
  }));

  const flaggedLabs = analytics.labAlerts
    .map((alert) => ({
      displayName: alert.marker,
      value: alert.value,
      unit: alert.unit,
      flag: alert.flag,
      collectedAt: alert.observedAt,
      referenceRange: alert.reference
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return {
    generatedAt,
    disclaimer: safetyNotice,
    patient: {
      displayName: profile.displayName,
      subjectKind: profile.subjectKind,
      birthDate: profile.birthDate,
      sex: profile.sex,
      heightCm: profile.heightCm,
      units: profile.units,
      height
    },
    totals: {
      observations: analytics.counts.observations,
      samples: analytics.counts.samples,
      activities: analytics.counts.activities
    },
    latestMeasurements,
    flaggedLabs,
    trends: analytics.trendCards.map((trend) => ({
      displayName: trend.label,
      unit: trend.unit,
      direction: trend.direction,
      summary: trend.summary
    })),
    sources: sourceImports
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
