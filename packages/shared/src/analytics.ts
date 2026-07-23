import type { AnalyticsSummary, HealthStoreData, MeasurementType, Observation, PersonalReferenceRange, SubjectKind, UnitSystem } from "./types.js";
import { classifyValueWithRange, resolveReferenceRange, toPreferredMeasurementValue } from "./measurementRegistry.js";

export function computeAnalytics(store: HealthStoreData): AnalyticsSummary {
  const counts = {
    imports: store.sourceImports.length,
    observations: store.observations.length,
    samples: store.timeSeriesSamples.length,
    activities: store.activitySessions.length,
    insights: store.insights.length,
    ...(store.healthEvents ? { healthEvents: store.healthEvents.length } : {}),
    ...(store.careItems ? { careItems: store.careItems.length } : {})
  };
  return computeAnalyticsFromInput({
    counts: counts as AnalyticsSummary["counts"],
    measurementTypes: store.measurementTypes,
    observations: store.observations,
    personalReferenceRanges: store.personalReferenceRanges,
    units: store.profile.units,
    subjectKind: store.profile.subjectKind
  });
}

export interface AnalyticsInput {
  counts: AnalyticsSummary["counts"];
  measurementTypes: MeasurementType[];
  observations: Observation[];
  units?: UnitSystem;
  subjectKind?: SubjectKind;
  personalReferenceRanges?: PersonalReferenceRange[];
}

export function computeAnalyticsFromInput(input: AnalyticsInput): AnalyticsSummary {
  const registry = new Map(input.measurementTypes.map((type) => [type.code, type]));
  const observationsByCode = groupBy(input.observations, (observation) => observation.measurementCode);
  const latestMetricsForInsight = [...observationsByCode.entries()]
    .map(([code, observations]) => latestMetric(
      code,
      observations,
      registry.get(code),
      input.units ?? "metric",
      input.subjectKind ?? "adult",
      input.personalReferenceRanges?.find((range) => range.measurementCode === code)
    ))
    .filter((metric): metric is NonNullable<typeof metric> => metric !== undefined)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  const latestMetrics = latestMetricsForInsight.slice(0, 12);

  const trendCards = [...observationsByCode.entries()]
    .map(([code, observations]) => trendCard(code, observations, registry.get(code), input.units ?? "metric"))
    .filter((card): card is NonNullable<typeof card> => card !== undefined)
    .slice(0, 8);

  const labAlerts = [...observationsByCode.entries()]
        .filter(([code]) => registry.get(code)?.category === "lab")
        .map(([code, observations]) => {
          const latest = [...observations].sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
          return labAlert(
            latest,
            registry.get(code),
            input.units ?? "metric",
            input.subjectKind ?? "adult",
            input.personalReferenceRanges?.find((range) => range.measurementCode === code)
          );
        })
        .filter((alert): alert is NonNullable<typeof alert> => alert !== undefined)
        .sort((a, b) => b.observedAt.localeCompare(a.observedAt))
        .slice(0, 12);

  const evidenceDigest = [
    `Imported ${input.counts.imports} source file(s), ${input.counts.observations} observations, and ${input.counts.samples} tracker samples.`,
    latestMetrics[0]
      ? `Latest tracked metric is ${latestMetrics[0].label}: ${latestMetrics[0].value} ${latestMetrics[0].unit}.`
      : "No latest metric is available yet.",
    labAlerts.length > 0
      ? `${labAlerts.length} lab marker(s) are outside supplied reference ranges.`
      : "No lab markers are outside supplied reference ranges."
  ];

  return {
    counts: input.counts,
    latestMetrics,
    latestMetricsForInsight,
    trendCards,
    labAlerts,
    evidenceDigest
  };
}

function latestMetric(
  code: string,
  observations: Observation[],
  type: MeasurementType | undefined,
  units: UnitSystem,
  subjectKind: SubjectKind,
  personalRange: PersonalReferenceRange | undefined
) {
  if (!type || observations.length === 0) return undefined;
  const latest = [...observations].sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
  const display = toPreferredMeasurementValue(latest.value, latest.unit, type, units);
  return {
    code,
    label: type.display,
    value: display.value,
    unit: display.unit,
    observedAt: latest.observedAt,
    status: classifyValueWithRange(
      latest.value,
      resolveReferenceRange(type, latest.unit, personalRange, subjectKind).effective
    )
  };
}

function trendCard(code: string, observations: Observation[], type: MeasurementType | undefined, units: UnitSystem) {
  if (!type || observations.length < 2) return undefined;
  const sorted = [...observations].sort((a, b) => a.observedAt.localeCompare(b.observedAt)).slice(-12);
  const points = sorted.map((observation) => ({
    date: observation.observedAt.slice(0, 10),
    value: toPreferredMeasurementValue(observation.value, observation.unit, type, units).value
  }));
  const first = points[0].value;
  const last = points[points.length - 1].value;
  const delta = last - first;
  const direction: "up" | "down" | "flat" = Math.abs(delta) < 0.01 ? "flat" : delta > 0 ? "up" : "down";
  return {
    code,
    label: type.display,
    unit: toPreferredMeasurementValue(sorted[sorted.length - 1].value, sorted[sorted.length - 1].unit, type, units).unit,
    points,
    direction,
    summary: `${type.display} is ${direction} over the latest ${points.length} reading(s).`
  };
}

function labAlert(
  observation: Observation,
  type: MeasurementType | undefined,
  units: UnitSystem,
  subjectKind: SubjectKind,
  personalRange: PersonalReferenceRange | undefined
) {
  if (!type) return undefined;
  const status = classifyValueWithRange(
    observation.value,
    resolveReferenceRange(type, observation.unit, personalRange, subjectKind).effective
  );
  const display = toPreferredMeasurementValue(observation.value, observation.unit, type, units);
  const range = resolveReferenceRange(type, display.unit, personalRange, subjectKind).effective;
  if (!range || status === "normal") return undefined;
  return {
    code: observation.measurementCode,
    marker: type.display,
    value: display.value,
    unit: display.unit,
    observedAt: observation.observedAt,
    reference: `${range.low ?? "-"}-${range.high ?? "-"}`,
    flag: status
  };
}

function groupBy<T>(items: T[], getKey: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    const group = grouped.get(key);
    if (group) {
      group.push(item);
    } else {
      grouped.set(key, [item]);
    }
  }
  return grouped;
}
