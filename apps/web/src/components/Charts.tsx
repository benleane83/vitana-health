/**
 * Chart primitives with semantic accessibility alternatives.
 *
 * Each chart exposes its data as accessible text via:
 * - A descriptive aria-label summarising the data range/trend
 * - <title> elements on SVG data points
 * - A visually-hidden <details> fallback for screen readers
 */
import type { AiQueryChartSeries } from "../api.js";
import type { HealthDataDetail, HealthDataDetailEntry } from "@local-fitness-advisor/shared";
import { formatChartTimestamp, formatDetailValue } from "../utils.js";

const flatChartPaddingRatio = 0.05;
const minimumFlatChartPadding = 1;

function detailKindLabel(kind: HealthDataDetailEntry["kind"]): string {
  return { observation: "Observation", sample: "Sample", activity: "Activity" }[kind];
}

// ─── Density bar (progress semantics) ────────────────────────────────────────

export function DensityBar({ density }: { density: number }) {
  const pct = Math.round(Math.min(100, density));
  return (
    <div
      className="density"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Data vault density: ${pct}%`}
    >
      <span style={{ width: `${pct}%` }} aria-hidden="true" />
    </div>
  );
}

// ─── Sparkline (trend mini chart) ─────────────────────────────────────────────

export function MiniChart({ label, points }: { label: string; points: Array<{ date: string; value: number }> }) {
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const path = points
    .map((point, index) => {
      const x = (index / Math.max(1, points.length - 1)) * 100;
      const y = 100 - ((point.value - min) / range) * 80 - 10;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  const summaryText =
    points.length >= 2
      ? `${label}: ${points.length} readings, from ${min.toFixed(1)} to ${max.toFixed(1)}`
      : `${label}: ${points.length} reading`;

  return (
    <svg viewBox="0 0 100 100" role="img" aria-label={summaryText} className="mini-chart">
      <title>{summaryText}</title>
      <path d={path} />
    </svg>
  );
}

// ─── Query result charts ───────────────────────────────────────────────────────

export function QueryChart({ chart }: { chart: { type: string; series: AiQueryChartSeries[] } }) {
  const values = chart.series.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const summaryText = chart.series.length > 0
    ? `Chart: ${chart.series.length} data points from ${chart.series[0].label} to ${chart.series[chart.series.length - 1].label}, values ${min.toFixed(1)}–${max.toFixed(1)}`
    : "Chart: no data";

  if (chart.type === "line" && chart.series.length > 1) {
    const path = chart.series
      .map((point, index) => {
        const x = (index / Math.max(1, chart.series.length - 1)) * 280;
        const y = 80 - ((point.value - min) / range) * 70;
        return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");
    return (
      <div className="query-chart-container">
        <svg viewBox="0 0 280 90" role="img" aria-label={summaryText} className="query-chart-svg">
          <title>{summaryText}</title>
          <path d={path} fill="none" stroke="currentColor" strokeWidth="2" />
          {chart.series.map((point, i) => {
            const x = (i / Math.max(1, chart.series.length - 1)) * 280;
            const y = 80 - ((point.value - min) / range) * 70;
            return (
              <circle key={point.label} cx={x} cy={y} r="3" fill="currentColor">
                <title>{`${point.label}: ${point.value}`}</title>
              </circle>
            );
          })}
        </svg>
        <div className="query-chart-labels" aria-hidden="true">
          <span>{chart.series[0].label}</span>
          <span>{chart.series[chart.series.length - 1].label}</span>
        </div>
      </div>
    );
  }

  // Bar chart
  return (
    <div className="query-chart-bars" role="list" aria-label={summaryText}>
      {chart.series.slice(0, 15).map((point) => {
        const pct = range > 0 ? ((point.value - min) / range) * 100 : 50;
        return (
          <div key={point.label} className="query-bar-item" role="listitem">
            <span className="query-bar-label">{point.label}</span>
            <div
              className="query-bar-track"
              role="meter"
              aria-valuenow={point.value}
              aria-valuemin={min}
              aria-valuemax={max}
              aria-label={`${point.label}: ${typeof point.value === "number" ? point.value.toFixed(1) : point.value}`}
            >
              <div className="query-bar-fill" style={{ width: `${Math.max(2, pct)}%` }} aria-hidden="true" />
            </div>
            <span className="query-bar-value" aria-hidden="true">
              {typeof point.value === "number" ? point.value.toFixed(1) : point.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Detail trend chart ────────────────────────────────────────────────────────

export function DetailTrendChart({ detail }: { detail: HealthDataDetail }) {
  const points = detail.chartPoints;
  if (points.length === 0) {
    return <p className="empty">No numeric points are available for charting.</p>;
  }

  const timestamps = points.map((p) => new Date(p.timestamp).getTime());
  const values = points.map((p) => p.value);
  const xMin = Math.min(...timestamps);
  const xMax = Math.max(...timestamps);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const flatPadding =
    rawMin === rawMax
      ? Math.max(Math.abs(rawMin) * flatChartPaddingRatio, minimumFlatChartPadding)
      : 0;
  const yMin = rawMin - flatPadding;
  const yMax = rawMax + flatPadding;
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;
  const unitLabel = [...new Set(points.map((p) => p.unit).filter(Boolean))].join(", ");
  const axisTimes = [xMin, xMin + xRange / 2, xMax];

  const path = points
    .map((point, index) => {
      const time = new Date(point.timestamp).getTime();
      const x = 24 + ((time - xMin) / xRange) * 272;
      const y = 108 - ((point.value - yMin) / yRange) * 84;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  const ariaLabel = `${detail.measurement.displayName} trend: ${points.length} readings, ${unitLabel || "value"} ${rawMin.toFixed(1)}–${rawMax.toFixed(1)}, from ${formatChartTimestamp(xMin, xRange)} to ${formatChartTimestamp(xMax, xRange)}`;

  return (
    <div className="summary-detail-chart">
      <svg
        viewBox="0 0 320 150"
        role="img"
        aria-label={ariaLabel}
        className="summary-detail-chart-svg"
      >
        <title>{ariaLabel}</title>
        <line x1="24" y1="24" x2="24" y2="108" className="summary-detail-axis" />
        <line x1="24" y1="108" x2="296" y2="108" className="summary-detail-axis" />
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2.5" className="summary-detail-chart-line" />
        {points.map((point) => {
          const time = new Date(point.timestamp).getTime();
          const x = 24 + ((time - xMin) / xRange) * 272;
          const y = 108 - ((point.value - yMin) / yRange) * 84;
          return (
            <circle
              key={`${point.kind}-${point.timestamp}-${point.value}`}
              cx={x}
              cy={y}
              r="3.5"
              className="summary-detail-chart-dot"
            >
              <title>{`${detailKindLabel(point.kind)} • ${point.timestamp} • ${formatDetailValue(point.value)} ${point.unit}`}</title>
            </circle>
          );
        })}
        <text x="12" y="28" className="summary-detail-y-label">{formatDetailValue(yMax)}</text>
        <text x="12" y="112" className="summary-detail-y-label">{formatDetailValue(yMin)}</text>
      </svg>
      <div className="summary-detail-chart-meta">
        <span>{unitLabel || "Value"}</span>
        <div className="summary-detail-chart-labels" aria-hidden="true">
          {axisTimes.map((time, index) => (
            <span key={`${time}-${index}`}>{formatChartTimestamp(time, xRange)}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
