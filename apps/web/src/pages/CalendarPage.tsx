import { useMemo, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { healthEventKindLabels } from "@vitana/shared";
import type {
  CalendarMonthData,
  CalendarMeasurementPoint,
  HealthEvent,
  MeasurementType
} from "@vitana/shared";
import { MeasurementCombobox } from "../components/MeasurementCombobox.js";

export interface MonthCell {
  date: string;
  day: number;
  inMonth: boolean;
}

export function buildMonthCells(month: string, weekStartsOn = localeWeekStart()): MonthCell[] {
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const offset = (first.getUTCDay() - weekStartsOn + 7) % 7;
  const cellCount = offset + days <= 35 ? 35 : 42;
  return Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(Date.UTC(year, monthNumber - 1, index - offset + 1));
    return {
      date: date.toISOString().slice(0, 10),
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === monthNumber - 1
    };
  });
}

export function localeWeekStart(locale = navigator.language): number {
  try {
    const weekInfo = (new Intl.Locale(locale) as Intl.Locale & { weekInfo?: { firstDay: number } }).weekInfo;
    if (weekInfo) return weekInfo.firstDay % 7;
  } catch {
    // Fall back to Sunday when the runtime does not expose locale week information.
  }
  return 0;
}

export function heatBuckets(points: CalendarMeasurementPoint[]): Map<string, number> {
  const unique = [...new Set(points.map((point) => point.value))].sort((left, right) => left - right);
  return new Map(points.map((point) => [
    point.date,
    unique.length === 1 ? 3 : 1 + Math.round((unique.indexOf(point.value) * 4) / (unique.length - 1))
  ]));
}

function measurementFor(
  data: CalendarMonthData | undefined,
  date: string,
  code: string | undefined
): CalendarMeasurementPoint | undefined {
  return code ? data?.measurements.find((point) => point.date === date && point.measurementCode === code) : undefined;
}

export function CalendarPage({
  month,
  timezone,
  data,
  loading,
  error,
  availableMeasurements,
  selectedMeasurements,
  selectedDate,
  today,
  eventDetails,
  eventLoading,
  eventError,
  onPreviousMonth,
  onNextMonth,
  onToday,
  onAddMeasurement,
  onRemoveMeasurement,
  onPromoteMeasurement,
  onSelectDate,
  onRetry,
  onRetryEvents
}: {
  month: string;
  timezone: string;
  data?: CalendarMonthData;
  loading: boolean;
  error?: string;
  availableMeasurements: MeasurementType[];
  selectedMeasurements: MeasurementType[];
  selectedDate: string;
  today: string;
  eventDetails: HealthEvent[];
  eventLoading: boolean;
  eventError?: string;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  onAddMeasurement: (measurement: MeasurementType) => void;
  onRemoveMeasurement: (code: string) => void;
  onPromoteMeasurement: (code: string) => void;
  onSelectDate: (date: string) => void;
  onRetry: () => void;
  onRetryEvents: () => void;
}) {
  const cells = useMemo(() => buildMonthCells(month), [month]);
  const primary = selectedMeasurements[0];
  const primaryPoints = data?.measurements.filter((point) => point.measurementCode === primary?.code) ?? [];
  const buckets = heatBuckets(primaryPoints);
  const selectedSummary = data?.events.find((summary) => summary.date === selectedDate);
  const selectedPoints = selectedMeasurements.flatMap((measurement) => {
    const point = measurementFor(data, selectedDate, measurement.code);
    return point ? [{ measurement, point }] : [];
  });
  const canAdd = selectedMeasurements.length < 3;
  const addable = availableMeasurements.filter(
    (measurement) => !selectedMeasurements.some((selected) => selected.code === measurement.code)
  );
  const weekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" });
  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });
  const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: "full",
    timeZone: "UTC"
  });
  const weekStart = localeWeekStart();
  const weekdays = Array.from({ length: 7 }, (_, index) =>
    weekdayFormatter.format(new Date(Date.UTC(2026, 7, 2 + ((weekStart + index) % 7)))));

  function accessibleLabel(date: string): string {
    const parts = [fullDateFormatter.format(new Date(`${date}T00:00:00Z`))];
    for (const measurement of selectedMeasurements) {
      const point = measurementFor(data, date, measurement.code);
      parts.push(point
        ? `${measurement.display}: ${formatValue(point.value)} ${point.unit}`
        : `${measurement.display}: no reading`);
    }
    const events = data?.events.find((summary) => summary.date === date)?.count ?? 0;
    parts.push(events === 1 ? "1 completed health event" : `${events} completed health events`);
    return parts.join(". ");
  }

  function handleDayKey(event: ReactKeyboardEvent<HTMLButtonElement>, date: string) {
    const currentIndex = cells.findIndex((cell) => cell.date === date);
    let nextIndex: number | undefined;
    if (event.key === "ArrowLeft") nextIndex = currentIndex - 1;
    if (event.key === "ArrowRight") nextIndex = currentIndex + 1;
    if (event.key === "ArrowUp") nextIndex = currentIndex - 7;
    if (event.key === "ArrowDown") nextIndex = currentIndex + 7;
    if (event.key === "Home") nextIndex = currentIndex - (currentIndex % 7);
    if (event.key === "End") nextIndex = currentIndex + (6 - (currentIndex % 7));
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectDate(date);
      return;
    }
    if (nextIndex === undefined) return;
    event.preventDefault();
    const inMonthCells = cells.filter((cell) => cell.inMonth);
    const target = cells[nextIndex];
    const resolved = target?.inMonth
      ? target
      : nextIndex < currentIndex ? inMonthCells[0] : inMonthCells[inMonthCells.length - 1];
    document.getElementById(`calendar-day-${resolved.date}`)?.focus();
  }

  return (
    <section className="panel calendar-page" aria-labelledby="calendar-heading">
      <header className="calendar-header">
        <div>
          <p className="eyebrow">Track</p>
          <h1 id="calendar-heading">Calendar</h1>
          <p>Compare recorded measurements with completed health events.</p>
        </div>
        <div className="calendar-month-controls">
          <button type="button" aria-label="Previous month" onClick={onPreviousMonth}>‹</button>
          <h2 aria-live="polite">{dateFormatter.format(new Date(`${month}-01T00:00:00Z`))}</h2>
          <button type="button" aria-label="Next month" onClick={onNextMonth}>›</button>
          <button type="button" onClick={onToday}>Today</button>
        </div>
      </header>

      <div className="calendar-metric-controls">
        {canAdd && addable.length ? (
          <MeasurementCombobox
            id="calendar-measurement-picker"
            ariaLabel="Add a measurement"
            measurementTypes={addable}
            selectedCode=""
            onSelect={onAddMeasurement}
          />
        ) : null}
        <div className="calendar-metric-list" aria-label="Selected measurements">
          {selectedMeasurements.map((measurement, index) => (
            <div className={`calendar-metric metric-${index + 1}`} key={measurement.code}>
              <span aria-hidden="true" className="metric-key" />
              <strong>{measurement.display}</strong>
              {index > 0 ? (
                <button type="button" onClick={() => onPromoteMeasurement(measurement.code)}>
                  Use for heatmap
                </button>
              ) : <span>Heatmap</span>}
              <button type="button" aria-label={`Remove ${measurement.display}`} onClick={() => onRemoveMeasurement(measurement.code)}>×</button>
            </div>
          ))}
          {!selectedMeasurements.length ? <p>No recorded measurements yet. Completed events still appear below.</p> : null}
        </div>
      </div>

      {error ? (
        <div className="calendar-error" role="alert">
          <span>{error}</span> <button type="button" onClick={onRetry}>Retry</button>
        </div>
      ) : null}

      <div className="calendar-layout">
        <div className={`calendar-grid-wrap${loading ? " is-loading" : ""}`} aria-busy={loading}>
          <table className="calendar-grid">
            <thead><tr>{weekdays.map((weekday) => <th scope="col" key={weekday}>{weekday}</th>)}</tr></thead>
            <tbody>
              {Array.from({ length: cells.length / 7 }, (_, week) => (
                <tr key={week}>
                  {cells.slice(week * 7, week * 7 + 7).map((cell) => {
                    const point = measurementFor(data, cell.date, primary?.code);
                    const comparisons = selectedMeasurements.slice(1).map((measurement) =>
                      measurementFor(data, cell.date, measurement.code));
                    const eventSummary = data?.events.find((summary) => summary.date === cell.date);
                    const selected = cell.date === selectedDate;
                    return (
                      <td key={cell.date} className={!cell.inMonth ? "outside-month" : ""}>
                        {cell.inMonth ? (
                          <button
                            id={`calendar-day-${cell.date}`}
                            type="button"
                            className={`calendar-day heat-${buckets.get(cell.date) ?? 0}${selected ? " is-selected" : ""}${cell.date === today ? " is-today" : ""}`}
                            aria-label={accessibleLabel(cell.date)}
                            aria-pressed={selected}
                            tabIndex={selected ? 0 : -1}
                            onClick={() => onSelectDate(cell.date)}
                            onKeyDown={(event) => handleDayKey(event, cell.date)}
                          >
                            <span className="calendar-day-number">{cell.day}</span>
                            <span className="calendar-day-value">{point ? formatValue(point.value) : <span aria-label="No reading">—</span>}</span>
                            <span className="calendar-day-marks">
                              {comparisons.map((comparison, index) => comparison
                                ? <span key={index} className={`comparison-mark comparison-${index + 1}`} aria-hidden="true" />
                                : null)}
                              {eventSummary ? <span className="event-mark" aria-hidden="true">● {eventSummary.count}</span> : null}
                            </span>
                          </button>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {primary ? (
            <div className="calendar-legend" aria-label={`${primary.display} relative magnitude this month`}>
              <span>Lower this month</span>
              {[1, 2, 3, 4, 5].map((level) => <span className={`legend-swatch heat-${level}`} key={level} />)}
              <span>Higher this month</span>
              <small>{primary.canonicalUnit} · {primary.aggregation}</small>
            </div>
          ) : null}
        </div>

        <aside className="calendar-inspector" aria-labelledby="inspector-heading">
          <h2 id="inspector-heading">{fullDateFormatter.format(new Date(`${selectedDate}T00:00:00Z`))}</h2>
          <p className="calendar-timezone">Days use {timezone}.</p>
          <h3>Measurements</h3>
          {selectedPoints.length ? selectedPoints.map(({ measurement, point }) => (
            <dl key={measurement.code} className="calendar-reading">
              <div><dt>Measurement</dt><dd>{measurement.display}</dd></div>
              <div><dt>Value</dt><dd>{formatValue(point.value)} {point.unit}</dd></div>
              <div><dt>Aggregation</dt><dd>{point.aggregation} · {point.count} reading{point.count === 1 ? "" : "s"}</dd></div>
              <div><dt>Range</dt><dd>{formatValue(point.min)}–{formatValue(point.max)} {point.unit}</dd></div>
              <div><dt>Source</dt><dd>{point.sources.join(", ") || "Unknown source"}</dd></div>
            </dl>
          )) : <p>No readings for selected metrics.</p>}
          <h3>Completed health events {selectedSummary ? `(${selectedSummary.count})` : ""}</h3>
          {eventLoading ? <p role="status">Loading event details…</p> : null}
          {eventError ? <p role="alert">{eventError} <button type="button" onClick={onRetryEvents}>Retry</button></p> : null}
          {!eventLoading && !eventError && selectedSummary ? (
            <ul className="calendar-events">
              {eventDetails.map((event) => (
                <li key={event.id}>
                  <strong>{healthEventKindLabels[event.kind]}</strong>
                  {event.provider ? <span>Provider: {event.provider}</span> : null}
                  {event.notes ? <span>{event.notes}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {!selectedSummary ? <p>No completed health events.</p> : null}
        </aside>
      </div>
    </section>
  );
}

function formatValue(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}
