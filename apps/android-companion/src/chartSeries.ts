import type {
  HealthDataChartSeries,
  HealthDataChartSeriesOptions,
  HealthDataDetailChartPoint,
  HealthDataDetail
} from "@vitana/shared";

const maxRawChartPoints = 500;
const maxDailyChartBuckets = 366;

export function chartSeriesFromDetail(
  detail: HealthDataDetail,
  options: HealthDataChartSeriesOptions,
  now = new Date()
): HealthDataChartSeries {
  return chartSeriesFromPoints(detail.measurement.code, detail.measurement.aggregation ?? "none", detail.chartPoints, options, now);
}

export function chartSeriesFromPoints(
  measurementCode: string,
  aggregation: HealthDataChartSeries["aggregation"],
  points: readonly HealthDataDetailChartPoint[],
  options: HealthDataChartSeriesOptions,
  now = new Date()
): HealthDataChartSeries {
  const cutoff = chartRangeCutoff(options.range, now);
  const rawPoints = points
    .filter((point) => !cutoff || point.timestamp >= cutoff)
    .map((point) => ({ ...point, count: 1 }))
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));

  if (options.mode === "raw" || (aggregation !== "sum" && aggregation !== "average")) {
    const truncated = rawPoints.length > maxRawChartPoints;
    return {
      generatedAt: new Date().toISOString(),
      measurementCode,
      range: options.range,
      requestedMode: options.mode,
      granularity: "raw",
      aggregation,
      points: truncated ? rawPoints.slice(-maxRawChartPoints) : rawPoints,
      totalPoints: rawPoints.length,
      truncated
    };
  }

  const dailyPoints = aggregatePoints(rawPoints, aggregation, "daily");
  const granularity = options.range === "all" && dailyPoints.length > maxDailyChartBuckets ? "weekly" : "daily";
  const aggregatedPoints = granularity === "weekly" ? aggregatePoints(rawPoints, aggregation, "weekly") : dailyPoints;
  return {
    generatedAt: new Date().toISOString(),
    measurementCode,
    range: options.range,
    requestedMode: options.mode,
    granularity,
    aggregation,
    points: aggregatedPoints,
    totalPoints: aggregatedPoints.length,
    truncated: false
  };
}

export function chartRangeCutoff(range: HealthDataChartSeriesOptions["range"], now = new Date()): string | undefined {
  if (range === "all") return undefined;
  const cutoff = new Date(now);
  if (range === "1y") cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  else if (range === "3m") cutoff.setUTCMonth(cutoff.getUTCMonth() - 3);
  else cutoff.setUTCMonth(cutoff.getUTCMonth() - 1);
  return cutoff.toISOString();
}

function aggregatePoints(
  points: HealthDataChartSeries["points"],
  aggregation: "sum" | "average",
  granularity: "daily" | "weekly"
): HealthDataChartSeries["points"] {
  const buckets = new Map<string, HealthDataChartSeries["points"]>();
  for (const point of points) {
    const date = new Date(point.timestamp);
    if (granularity === "weekly") {
      const day = date.getUTCDay();
      date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
    }
    date.setUTCHours(0, 0, 0, 0);
    const key = date.toISOString();
    const bucket = buckets.get(key) ?? [];
    bucket.push(point);
    buckets.set(key, bucket);
  }
  return [...buckets].map(([timestamp, bucket]) => {
    const values = bucket.map((point) => point.value);
    const total = values.reduce((sum, value) => sum + value, 0);
    return {
      timestamp,
      value: aggregation === "sum" ? total : total / values.length,
      unit: bucket.map((point) => point.unit).sort()[0] ?? "",
      count: values.length,
      minValue: Math.min(...values),
      maxValue: Math.max(...values),
      referenceRange: bucket[0]?.referenceRange
    };
  });
}
