import { profileDataCategories, type HealthDataSummary } from "@vitana/shared";

export function dashboardMetrics<T extends { isPinned: boolean }>(metrics: T[]): T[] {
  return [
    ...metrics.filter((metric) => metric.isPinned),
    ...metrics.filter((metric) => !metric.isPinned).slice(0, 4)
  ];
}

export function formatDashboardMetricValue(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return Number.isInteger(value) ? value.toString() : value.toFixed(1).replace(/\.?0+$/, "");
}

export function dashboardCategoryCounts(summary?: HealthDataSummary) {
  return profileDataCategories.map((category) => ({
    ...category,
    count: summary?.categories.find((entry) => entry.key === category.key)?.counts.total ?? 0
  }));
}

export function formatTrendSummary(label: string, summary: string): string {
  const labelPrefix = `${label} `;
  return summary.startsWith(labelPrefix) ? summary.slice(labelPrefix.length) : summary;
}

export function formatLabValue(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return Number.isInteger(value) ? value.toString() : value.toFixed(2).replace(/\.?0+$/, "");
}

export function formatLabReference(reference: string): string {
  return reference.replace(/^-+/, "");
}

export type SparklineGeometry = {
  path: string;
  count: number;
  min: number;
  max: number;
  lastPoint?: { x: number; y: number };
};

export function sparklineGeometry(
  points: Array<{ value: number }>,
  width: number,
  height: number,
  padding = 4
): SparklineGeometry | undefined {
  const values = points.map((point) => point.value).filter(Number.isFinite);
  if (values.length === 0 || width <= padding * 2 || height <= padding * 2) return undefined;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const drawableWidth = width - padding * 2;
  const drawableHeight = height - padding * 2;
  const coordinates = values.map((value, index) => ({
    x: padding + (index / Math.max(1, values.length - 1)) * drawableWidth,
    y: range === 0
      ? height / 2
      : padding + (1 - (value - min) / range) * drawableHeight
  }));

  return {
    path: coordinates.map((point, index) =>
      `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" "),
    count: values.length,
    min,
    max,
    lastPoint: coordinates.at(-1)
  };
}