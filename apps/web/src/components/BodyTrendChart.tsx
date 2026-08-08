import { useState } from "react";
import type { BodyTrendPoint } from "@vitana/shared";
import { formatDetailValue, formatShortTimestamp } from "../utils.js";

const series = [
  { key: "muscleMass", label: "Muscle Mass", className: "body-trend-muscle" },
  { key: "fatMass", label: "Fat", className: "body-trend-fat" },
  { key: "boneMineralContent", label: "Bone mineral", className: "body-trend-bone" }
] as const;

export function BodyTrendChart({
  points,
  unit,
  selectedDate,
  onSelect
}: {
  points: BodyTrendPoint[];
  unit: string;
  selectedDate?: string;
  onSelect: (date: string) => void;
}) {
  const [hoveredDate, setHoveredDate] = useState<string>();
  const totals = points.map((point) => point.components.weight ?? (
    point.components.muscleMass + point.components.fatMass + point.components.boneMineralContent
  ));
  const maximum = Math.max(
    1,
    ...points.map((point) => Math.max(
      point.components.muscleMass + point.components.fatMass + point.components.boneMineralContent,
      point.components.weight ?? 0
    ))
  );
  const active = points.find((point) => point.date === (hoveredDate ?? selectedDate));
  const chartWidth = Math.max(680, points.length * 72 + 104);
  const left = 58;
  const right = chartWidth - 22;
  const top = 20;
  const bottom = 240;
  const comparisonTop = 12;
  const comparisonBottom = 72;
  const innerWidth = right - left;
  const barWidth = Math.min(42, innerWidth / Math.max(1, points.length) * 0.62);
  const y = (value: number) => bottom - (value / maximum) * (bottom - top);
  const minimumTotal = Math.min(...totals);
  const maximumTotal = Math.max(...totals);
  const totalPadding = Math.max(0.25, (maximumTotal - minimumTotal) * 0.15);
  const comparisonMinimum = minimumTotal - totalPadding;
  const comparisonMaximum = maximumTotal + totalPadding;
  const comparisonRange = comparisonMaximum - comparisonMinimum;
  const comparisonY = (value: number) => comparisonBottom - ((value - comparisonMinimum) / comparisonRange) * (comparisonBottom - comparisonTop);
  const comparisonPoints = totals.map((value, index) => `${left + ((index + 0.5) / points.length) * innerWidth},${comparisonY(value)}`).join(" ");
  const summary = points.length
    ? `Body composition trend with ${points.length} complete readings from ${formatShortTimestamp(points[0]!.observedAt)} to ${formatShortTimestamp(points[points.length - 1]!.observedAt)}.`
    : "No complete body composition readings are available.";

  return (
    <div className="body-trend-chart">
      <div className="body-trend-legend" aria-label="Chart legend">
        {series.map((item) => <span key={item.key}><i className={item.className} aria-hidden="true" />{item.label}</span>)}
        <span><i className="body-trend-weight" aria-hidden="true" />Weight</span>
      </div>
      <div className="body-trend-comparison" aria-label="Total mass comparison for selected range">
        <span>Total weight</span>
        <svg viewBox={`0 0 ${chartWidth} 84`} width={chartWidth} height="84" role="img" aria-label={`Total mass for the selected range, from ${formatDetailValue(minimumTotal)} to ${formatDetailValue(maximumTotal)} ${unit}.`}>
          <line className="summary-detail-gridline" x1={left} x2={right} y1={comparisonTop} y2={comparisonTop} />
          <line className="summary-detail-gridline" x1={left} x2={right} y1={comparisonBottom} y2={comparisonBottom} />
          <text className="summary-detail-y-label" x={left - 8} y={comparisonTop + 4} textAnchor="end">{formatDetailValue(maximumTotal)}</text>
          <text className="summary-detail-y-label" x={left - 8} y={comparisonBottom + 4} textAnchor="end">{formatDetailValue(minimumTotal)}</text>
          <polyline className="body-trend-comparison-line" points={comparisonPoints} />
          {points.map((point, index) => {
            const center = left + ((index + 0.5) / points.length) * innerWidth;
            const selected = point.date === selectedDate;
            return <circle key={point.sessionId} className={selected ? "body-trend-comparison-point is-selected" : "body-trend-comparison-point"} cx={center} cy={comparisonY(totals[index]!)} r="4">
              <title>{`${formatShortTimestamp(point.observedAt)}: ${formatDetailValue(totals[index]!)} ${unit}`}</title>
            </circle>;
          })}
        </svg>
      </div>
      <div className="body-trend-chart-scroll">
        <svg className="body-trend-chart-svg" width={chartWidth} height="280" viewBox={`0 0 ${chartWidth} 280`} role="img" aria-label={summary}>
          <title>{summary}</title>
          {[0, 0.5, 1].map((fraction) => {
            const value = maximum * fraction;
            const lineY = y(value);
            return <g key={fraction}>
              <line className="summary-detail-gridline" x1={left} x2={right} y1={lineY} y2={lineY} />
              <text className="summary-detail-y-label" x={left - 8} y={lineY + 4} textAnchor="end">{formatDetailValue(value)}</text>
            </g>;
          })}
          {points.map((point, index) => {
            const center = left + ((index + 0.5) / points.length) * innerWidth;
            const values = series.map((item) => point.components[item.key]);
            let cumulative = 0;
            const selected = point.date === selectedDate;
            return <g key={point.sessionId} className={selected ? "is-selected" : undefined}>
              {values.map((value, segmentIndex) => {
                const previous = cumulative;
                cumulative += value;
                return <rect
                  key={series[segmentIndex].key}
                  className={series[segmentIndex].className}
                  x={center - barWidth / 2}
                  y={y(cumulative)}
                  width={barWidth}
                  height={Math.max(1, y(previous) - y(cumulative))}
                />;
              })}
              {point.components.weight !== undefined ? <line className="body-trend-weight-line" x1={center - barWidth / 2 - 4} x2={center + barWidth / 2 + 4} y1={y(point.components.weight)} y2={y(point.components.weight)} /> : null}
              <rect
                className="body-trend-hit-target"
                x={center - Math.max(24, barWidth / 2 + 8)}
                y={top}
                width={Math.max(48, barWidth + 16)}
                height={bottom - top}
                tabIndex={0}
                role="button"
                aria-label={`${formatShortTimestamp(point.observedAt)}: Muscle Mass ${formatDetailValue(point.components.muscleMass)} ${unit}, fat ${formatDetailValue(point.components.fatMass)} ${unit}, bone mineral ${formatDetailValue(point.components.boneMineralContent)} ${unit}`}
                onClick={() => onSelect(point.date)}
                onFocus={() => setHoveredDate(point.date)}
                onBlur={() => setHoveredDate(undefined)}
                onMouseEnter={() => setHoveredDate(point.date)}
                onMouseLeave={() => setHoveredDate(undefined)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(point.date);
                  }
                }}
              />
              <text className="summary-detail-x-label" x={center} y={264} textAnchor="middle">{new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(`${point.date}T12:00:00`))}</text>
            </g>;
          })}
        </svg>
      </div>
      {active ? <p className="body-trend-chart-tooltip" aria-live="polite">{formatShortTimestamp(active.observedAt)}: {formatDetailValue(active.components.muscleMass)} Muscle Mass, {formatDetailValue(active.components.fatMass)} fat, {formatDetailValue(active.components.boneMineralContent)} bone mineral {unit}{active.components.weight === undefined ? "" : `; weight ${formatDetailValue(active.components.weight)} ${unit}`}</p> : null}
      <details className="sr-only">
        <summary>Body Trend data table</summary>
        <ul>{points.map((point) => <li key={point.sessionId}>{formatShortTimestamp(point.observedAt)}: Muscle Mass {formatDetailValue(point.components.muscleMass)} {unit}, fat {formatDetailValue(point.components.fatMass)} {unit}, bone mineral {formatDetailValue(point.components.boneMineralContent)} {unit}</li>)}</ul>
      </details>
    </div>
  );
}
