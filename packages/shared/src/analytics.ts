import type { AnalyticsSummary, HealthStoreData, MeasurementType, Observation, PersonalReferenceRange, SubjectKind, UnitSystem } from "./types.js";
import { classifyValueWithRange, resolveReferenceRange, toPreferredMeasurementValue } from "./measurementRegistry.js";

/**
 * The slice of a profile analytics actually reads. Deliberately narrower than {@link HealthStoreData}
 * so callers are not forced into a full-profile read just to satisfy the type.
 */
export interface AnalyticsStoreProjection {
  profile: Pick<HealthStoreData["profile"], "units" | "subjectKind">;
  measurementTypes: MeasurementType[];
  observations: Observation[];
  personalReferenceRanges?: PersonalReferenceRange[];
  pinnedMeasurements?: HealthStoreData["pinnedMeasurements"];
  counts: AnalyticsSummary["counts"];
}

export function computeAnalytics(store: AnalyticsStoreProjection): AnalyticsSummary {
  return computeAnalyticsFromInput({
    counts: store.counts,
    measurementTypes: store.measurementTypes,
    observations: store.observations,
    personalReferenceRanges: store.personalReferenceRanges,
    pinnedMeasurements: store.pinnedMeasurements,
    units: store.profile.units,
    subjectKind: store.profile.subjectKind
  });
}

/** Counts derived from a whole store, for the callers that genuinely hold one. */
export function analyticsCountsFromStore(store: HealthStoreData): AnalyticsSummary["counts"] {
  return {
    imports: store.sourceImports.length,
    observations: store.observations.length,
    samples: store.timeSeriesSamples.length,
    activities: store.activitySessions.length,
    insights: store.insights.length,
    ...(store.healthEvents ? { healthEvents: store.healthEvents.length } : {}),
    ...(store.careItems ? { careItems: store.careItems.length } : {})
  } as AnalyticsSummary["counts"];
}

export interface AnalyticsInput {
  counts: AnalyticsSummary["counts"];
  measurementTypes: MeasurementType[];
  observations: Observation[];
  units?: UnitSystem;
  subjectKind?: SubjectKind;
  personalReferenceRanges?: PersonalReferenceRange[];
  pinnedMeasurements?: HealthStoreData["pinnedMeasurements"];
}

export function computeAnalyticsFromInput(input: AnalyticsInput): AnalyticsSummary {
  const registry = new Map(input.measurementTypes.map((type) => [type.code, type]));
  const pinnedCodes = new Set(input.pinnedMeasurements?.map((pin) => pin.measurementCode) ?? []);
  const observationsByCode = groupBy(input.observations, (observation) => observation.measurementCode);
  // Indexed once. Looking the range up with `find` inside the per-code loops below made this a
  // scan of every personal range for every measurement the profile records.
  const personalRanges = new Map((input.personalReferenceRanges ?? []).map((range) => [range.measurementCode, range]));
  const latestMetricsForInsight = [...observationsByCode.entries()]
    .map(([code, observations]) => latestMetric(
      code,
      observations,
      registry.get(code),
      input.units ?? "metric",
      input.subjectKind ?? "adult",
      personalRanges.get(code),
      pinnedCodes.has(code)
    ))
    .filter((metric): metric is NonNullable<typeof metric> => metric !== undefined)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  const latestMetrics = [
    ...latestMetricsForInsight.filter((metric) => metric.isPinned),
    ...latestMetricsForInsight.filter((metric) => !metric.isPinned).slice(0, 12)
  ];

  const trendCards = [...observationsByCode.entries()]
    .map(([code, observations]) => trendCard(code, observations, registry.get(code), input.units ?? "metric"))
    .filter((card): card is NonNullable<typeof card> => card !== undefined)
    .slice(0, 8);

  const allRangeAlerts = [...observationsByCode.entries()]
    .filter(([code]) => {
      const category = registry.get(code)?.category;
      return category === "body" || category === "lab";
    })
    .map(([code, observations]) => {
      const latest = latestObservation(observations);
      return rangeAlert(
        latest,
        registry.get(code),
        input.units ?? "metric",
        input.subjectKind ?? "adult",
        personalRanges.get(code)
      );
    })
    .filter((alert): alert is NonNullable<typeof alert> => alert !== undefined)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  const rangeAlerts = allRangeAlerts.slice(0, 12);
  const labAlerts = allRangeAlerts
    .filter((alert) => alert.category === "lab")
    .slice(0, 12)
    .map((alert) => ({
      code: alert.code,
      marker: alert.marker,
      value: alert.value,
      unit: alert.unit,
      observedAt: alert.observedAt,
      reference: alert.reference,
      flag: alert.flag
    }));

  const evidenceDigest = [
    `Imported ${input.counts.imports} source file(s), ${input.counts.observations} observations, and ${input.counts.samples} tracker samples.`,
    latestMetricsForInsight[0]
      ? `Latest tracked metric is ${latestMetricsForInsight[0].label}: ${latestMetricsForInsight[0].value} ${latestMetricsForInsight[0].unit}.`
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
    rangeAlerts,
    evidenceDigest
  };
}

/**
 * A single linear scan. Copying and fully sorting a series just to read its first element was the
 * hot path here — every measurement code paid for it on every analytics run.
 */
function latestObservation(observations: Observation[]): Observation {
  return observations.reduce((latest, observation) =>
    observation.observedAt.localeCompare(latest.observedAt) > 0 ? observation : latest);
}

function latestMetric(
  code: string,
  observations: Observation[],
  type: MeasurementType | undefined,
  units: UnitSystem,
  subjectKind: SubjectKind,
  personalRange: PersonalReferenceRange | undefined,
  isPinned: boolean
) {
  if (!type || observations.length === 0) return undefined;
  const latest = latestObservation(observations);
  const display = toPreferredMeasurementValue(latest.value, latest.unit, type, units);
  return {
    code,
    label: type.display,
    value: display.value,
    unit: display.unit,
    observedAt: latest.observedAt,
    isPinned,
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
  if (direction === "flat") return undefined;
  return {
    code,
    label: type.display,
    unit: toPreferredMeasurementValue(sorted[sorted.length - 1].value, sorted[sorted.length - 1].unit, type, units).unit,
    points,
    direction,
    summary: `${type.display} is ${direction} over the latest ${points.length} reading(s).`
  };
}

function rangeAlert(
  observation: Observation,
  type: MeasurementType | undefined,
  units: UnitSystem,
  subjectKind: SubjectKind,
  personalRange: PersonalReferenceRange | undefined
) {
  if (!type || (type.category !== "body" && type.category !== "lab")) return undefined;
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
    category: type.category,
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
