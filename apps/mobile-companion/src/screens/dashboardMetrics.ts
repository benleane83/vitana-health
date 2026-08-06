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