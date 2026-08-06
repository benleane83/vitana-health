export function dashboardMetrics<T extends { isPinned: boolean }>(metrics: T[]): T[] {
  return [
    ...metrics.filter((metric) => metric.isPinned),
    ...metrics.filter((metric) => !metric.isPinned).slice(0, 4)
  ];
}