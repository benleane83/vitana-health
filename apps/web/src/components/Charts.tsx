/**
 * Chart primitives with semantic accessibility alternatives.
 *
 * Each chart exposes its data as accessible text via:
 * - A descriptive aria-label summarising the data range/trend
 * - <title> elements on SVG data points
 * - A visually-hidden <details> fallback for screen readers
 */
import { useState } from "react";
import type { AiQueryChartSeries } from "../api.js";
import type {
  HealthDataChartMode,
  HealthDataChartRange,
  HealthDataChartSeries,
  HealthDataChartSeriesPoint,
  HealthDataDetail,
  HealthDataDetailEntry,
  ReferenceRange
} from "@vitana/shared";
import { formatChartTimestamp, formatDetailValue, formatTimestamp } from "../utils.js";

const flatChartPaddingRatio = 0.05;
const minimumFlatChartPadding = 1;
const trendRanges: Array<{ value: HealthDataChartRange; label: string }> = [
  { value: "all", label: "All" },
  { value: "1y", label: "1Y" },
  { value: "3m", label: "3M" },
  { value: "1m", label: "1M" }
];

function niceStep(range: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(range || 1));
  const normalized = range / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

function chartTicks(minimum: number, maximum: number, count = 5): number[] {
  const step = niceStep((maximum - minimum) / Math.max(1, count - 1));
  const first = Math.floor(minimum / step) * step;
  const last = Math.ceil(maximum / step) * step;
  const ticks: number[] = [];
  for (let tick = first; tick <= last + step / 1000; tick += step) {
    if (tick >= minimum && tick <= maximum) {
      ticks.push(Number(tick.toPrecision(12)));
    }
  }
  return ticks;
}

function compatibleReferenceRange(points: HealthDataChartSeriesPoint[]): ReferenceRange | undefined {
  const unit = points[0]?.unit;
  return points.find((point) =>
    point.referenceRange &&
    point.referenceRange.unit === unit &&
    (point.referenceRange.low !== undefined || point.referenceRange.high !== undefined)
  )?.referenceRange;
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

export function DetailTrendChart({
  detail,
  series,
  range,
  mode,
  busy,
  error,
  onRangeChange,
  onModeChange
}: {
  detail: HealthDataDetail;
  series?: HealthDataChartSeries;
  range: HealthDataChartRange;
  mode: HealthDataChartMode;
  busy: boolean;
  error?: string;
  onRangeChange: (range: HealthDataChartRange) => void;
  onModeChange: (mode: HealthDataChartMode) => void;
}) {
  const points = series?.points ?? [];
  const [activePoint, setActivePoint] = useState<HealthDataChartSeriesPoint | undefined>();

  if (busy && !series) {
    return <p className="empty" role="status">Loading trend…</p>;
  }
  if (error && !series) {
    return <p className="empty" role="alert">{error}</p>;
  }
  if (points.length === 0) {
    return <p className="empty">No numeric points are available for charting.</p>;
  }

  const referenceRange = compatibleReferenceRange(points);
  const unitLabel = [...new Set(points.map((point) => point.unit).filter(Boolean))].join(", ");
  const referenceLabel = referenceRange
    ? `Reference range: ${referenceRange.low ?? "—"}–${referenceRange.high ?? "—"} ${referenceRange.unit}`
    : undefined;

  const rangeControls = (
    <div className="summary-detail-chart-toolbar" role="group" aria-label="Trend chart controls">
      {trendRanges.map((rangeOption) => (
        <button
          type="button"
          key={rangeOption.value}
          className={range === rangeOption.value ? "active" : ""}
          aria-pressed={range === rangeOption.value}
          onClick={() => {
            onRangeChange(rangeOption.value);
            setActivePoint(undefined);
          }}
        >
          {rangeOption.label}
        </button>
      ))}
      {series?.aggregation !== "latest" ? (
        <>
          <span className="summary-detail-chart-toolbar-separator" aria-hidden="true" />
          {(["auto", "raw"] as const).map((modeOption) => (
            <button
              type="button"
              key={modeOption}
              className={mode === modeOption ? "active" : ""}
              aria-pressed={mode === modeOption}
              title={modeOption === "auto" ? "Adjust detail to the selected time range" : "Show individual recorded readings"}
              onClick={() => {
                onModeChange(modeOption);
                setActivePoint(undefined);
              }}
            >
              {modeOption === "auto" ? "Adaptive" : "Readings"}
            </button>
          ))}
        </>
      ) : null}
    </div>
  );

  if (points.length === 1) {
    const point = points[0];
    return (
      <div className="summary-detail-chart">
        <div className="summary-detail-section-heading summary-detail-chart-heading">
          <h3>Trend</h3>
          {rangeControls}
        </div>
        <div className="summary-detail-single-reading" role="img" aria-label={`${detail.measurement.displayName} trend: 1 reading`}>
          <div>
            <strong>Not enough data for a trend yet</strong>
            <span>A second reading will reveal change over time.</span>
          </div>
          <p>
            <span>{formatTimestamp(point.timestamp)}</span>
            <strong>{formatDetailValue(point.value)} {point.unit}</strong>
          </p>
        </div>
        {referenceLabel ? <span className="sr-only">{referenceLabel}</span> : null}
      </div>
    );
  }

  const timestamps = points.map((p) => new Date(p.timestamp).getTime());
  const values = points.map((p) => p.value);
  const xMin = Math.min(...timestamps);
  const xMax = Math.max(...timestamps);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const referenceValues = [referenceRange?.low, referenceRange?.high].filter((value): value is number => value !== undefined);
  const combinedMin = Math.min(rawMin, ...referenceValues);
  const combinedMax = Math.max(rawMax, ...referenceValues);
  const flatPadding =
    combinedMin === combinedMax
      ? Math.max(Math.abs(combinedMin) * flatChartPaddingRatio, minimumFlatChartPadding)
      : 0;
  const yPadding = flatPadding || (combinedMax - combinedMin) * flatChartPaddingRatio;
  const yMin = combinedMin - yPadding;
  const yMax = combinedMax + yPadding;
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;
  const yTicks = chartTicks(yMin, yMax);
  const axisTimes = [xMin, xMin + xRange / 3, xMin + (xRange * 2) / 3, xMax];
  const chartLeft = 64;
  const chartRight = 736;
  const chartTop = 24;
  const chartBottom = 266;
  const pointX = (point: HealthDataChartSeriesPoint) =>
    chartLeft + ((new Date(point.timestamp).getTime() - xMin) / xRange) * (chartRight - chartLeft);
  const pointY = (value: number) => chartBottom - ((value - yMin) / yRange) * (chartBottom - chartTop);

  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${pointX(point).toFixed(2)} ${pointY(point.value).toFixed(2)}`)
    .join(" ");

  const bucketLabel = series?.granularity === "raw" ? "readings" : `${series?.granularity ?? "daily"} buckets`;
  const ariaLabel = `${detail.measurement.displayName} trend: ${points.length} ${bucketLabel}, ${unitLabel || "value"} ${rawMin.toFixed(1)}–${rawMax.toFixed(1)}, from ${formatChartTimestamp(xMin, xRange)} to ${formatChartTimestamp(xMax, xRange)}`;

  return (
    <div className="summary-detail-chart">
      <div className="summary-detail-section-heading summary-detail-chart-heading">
        <h3>Trend</h3>
        {rangeControls}
      </div>
      <svg
        viewBox="0 0 760 320"
        role="img"
        aria-label={ariaLabel}
        className="summary-detail-chart-svg"
      >
        <title>{ariaLabel}</title>
        {referenceRange?.low !== undefined && referenceRange?.high !== undefined ? (
          <rect
            x={chartLeft}
            y={pointY(referenceRange.high)}
            width={chartRight - chartLeft}
            height={pointY(referenceRange.low) - pointY(referenceRange.high)}
            className="summary-detail-reference-band"
          />
        ) : null}
        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={chartLeft} y1={pointY(tick)} x2={chartRight} y2={pointY(tick)} className="summary-detail-gridline" />
            <text x={chartLeft - 10} y={pointY(tick) + 4} textAnchor="end" className="summary-detail-y-label">{formatDetailValue(tick)}</text>
          </g>
        ))}
        <line x1={chartLeft} y1={chartTop} x2={chartLeft} y2={chartBottom} className="summary-detail-axis" />
        <line x1={chartLeft} y1={chartBottom} x2={chartRight} y2={chartBottom} className="summary-detail-axis" />
        {[referenceRange?.low, referenceRange?.high].map((value, index) => value !== undefined ? (
          <g key={value}>
            <line x1={chartLeft} y1={pointY(value)} x2={chartRight} y2={pointY(value)} className="summary-detail-reference-line" />
            <text x={chartRight - 4} y={pointY(value) - 5} textAnchor="end" className="summary-detail-reference-label">
              {index === 0 ? "Ref. low" : "Ref. high"} {formatDetailValue(value)}
            </text>
          </g>
        ) : null)}
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2.5" className="summary-detail-chart-line" />
        {points.map((point, index) => {
          const x = pointX(point);
          const y = pointY(point.value);
          const pointLabel = `${series?.granularity === "raw" ? "Reading" : `${series?.granularity ?? "daily"} bucket`} • ${formatTimestamp(point.timestamp)} • ${formatDetailValue(point.value)} ${point.unit}${point.count > 1 ? ` • ${point.count} readings` : ""}`;
          return (
            <g key={`${point.timestamp}-${point.value}-${index}`}>
              <circle cx={x} cy={y} r="5" className="summary-detail-chart-dot" aria-hidden="true" />
              <circle
                cx={x}
                cy={y}
                r="22"
                className="summary-detail-chart-hit-target"
                tabIndex={0}
                role="button"
                aria-label={pointLabel}
                onMouseEnter={() => setActivePoint(point)}
                onFocus={() => setActivePoint(point)}
                onClick={() => setActivePoint(point)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setActivePoint(point);
                  }
                }}
              >
                <title>{pointLabel}</title>
              </circle>
            </g>
          );
        })}
        {axisTimes.map((time, index) => (
          <text
            key={`${time}-${index}`}
            x={chartLeft + ((time - xMin) / xRange) * (chartRight - chartLeft)}
            y={chartBottom + 24}
            textAnchor={index === 0 ? "start" : index === axisTimes.length - 1 ? "end" : "middle"}
            className="summary-detail-x-label"
          >
            {formatChartTimestamp(time, xRange)}
          </text>
        ))}
      </svg>
      <div className="summary-detail-chart-meta">
        <span className="sr-only">{unitLabel || "Value"}{referenceLabel ? ` • ${referenceLabel}` : ""}</span>
        <span className="summary-detail-chart-tooltip" aria-live="polite">
          {activePoint
            ? `${series?.granularity === "raw" ? "Reading" : `${series?.granularity ?? "daily"} bucket`} · ${formatTimestamp(activePoint.timestamp)} · ${formatDetailValue(activePoint.value)} ${activePoint.unit}${activePoint.count > 1 ? ` · ${activePoint.count} readings` : ""}`
            : "Hover, focus, or select a point for details."}
        </span>
        {series?.truncated ? <span>Showing the newest {series.points.length} of {series.totalPoints} raw readings.</span> : null}
      </div>
    </div>
  );
}
