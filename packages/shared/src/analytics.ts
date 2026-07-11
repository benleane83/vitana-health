import type { AnalyticsSummary, HealthStoreData, MeasurementType, Observation } from "./types.js";
import { classifyValue } from "./registry.js";

export function computeAnalytics(store: HealthStoreData): AnalyticsSummary {
  const registry = new Map(store.measurementTypes.map((type) => [type.code, type]));
  const observationsByCode = groupBy(store.observations, (observation) => observation.measurementCode);
  const latestMetrics = [...observationsByCode.entries()]
    .map(([code, observations]) => latestMetric(code, observations, registry.get(code)))
    .filter((metric): metric is NonNullable<typeof metric> => metric !== undefined)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt))
    .slice(0, 12);

  const trendCards = [...observationsByCode.entries()]
    .map(([code, observations]) => trendCard(code, observations, registry.get(code)))
    .filter((card): card is NonNullable<typeof card> => card !== undefined)
    .slice(0, 8);

  const labAlerts = store.observations
    .filter((observation) => {
      const category = registry.get(observation.measurementCode)?.category;
      return category === "lab" || category === "metabolic";
    })
    .map((observation) => labAlert(observation, registry.get(observation.measurementCode)))
    .filter((alert): alert is NonNullable<typeof alert> => alert !== undefined)
    .slice(0, 12);

  const evidenceDigest = [
    `Imported ${store.sourceImports.length} source file(s), ${store.observations.length} observations, and ${store.timeSeriesSamples.length} tracker samples.`,
    latestMetrics[0]
      ? `Latest tracked metric is ${latestMetrics[0].label}: ${latestMetrics[0].value} ${latestMetrics[0].unit}.`
      : "No latest metric is available yet.",
    labAlerts.length > 0
      ? `${labAlerts.length} lab marker(s) are outside supplied reference ranges.`
      : "No lab markers are outside supplied reference ranges."
  ];

  return {
    counts: {
      imports: store.sourceImports.length,
      observations: store.observations.length,
      samples: store.timeSeriesSamples.length,
      activities: store.activitySessions.length,
      labMarkers: 0,
      insights: store.insights.length
    },
    latestMetrics,
    trendCards,
    labAlerts,
    evidenceDigest
  };
}

function latestMetric(code: string, observations: Observation[], type?: MeasurementType) {
  if (!type || observations.length === 0) return undefined;
  const latest = [...observations].sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
  return {
    code,
    label: type.display,
    value: latest.value,
    unit: latest.unit,
    observedAt: latest.observedAt,
    status: classifyValue(latest.value, type, latest.unit)
  };
}

function trendCard(code: string, observations: Observation[], type?: MeasurementType) {
  if (!type || observations.length < 2) return undefined;
  const sorted = [...observations].sort((a, b) => a.observedAt.localeCompare(b.observedAt)).slice(-12);
  const points = sorted.map((observation) => ({
    date: observation.observedAt.slice(0, 10),
    value: observation.value
  }));
  const first = points[0].value;
  const last = points[points.length - 1].value;
  const delta = last - first;
  const direction: "up" | "down" | "flat" = Math.abs(delta) < 0.01 ? "flat" : delta > 0 ? "up" : "down";
  return {
    code,
    label: type.display,
    unit: sorted[sorted.length - 1].unit,
    points,
    direction,
    summary: `${type.display} is ${direction} over the latest ${points.length} reading(s).`
  };
}

function labAlert(observation: Observation, type?: MeasurementType) {
  if (!type) return undefined;
  const range = type.referenceRanges?.find((candidate) => candidate.unit === observation.unit);
  const status = classifyValue(observation.value, type, observation.unit);
  if (!range || status === "normal") return undefined;
  return {
    marker: type.display,
    value: observation.value,
    unit: observation.unit,
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
