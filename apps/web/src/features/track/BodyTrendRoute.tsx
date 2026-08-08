import { useEffect, useState } from "react";
import type { BodyTrendDateDetail, BodyTrendTimeline, HealthDataChartRange } from "@vitana/shared";
import { api } from "../../api.js";
import { BodyTrendChart } from "../../components/BodyTrendChart.js";
import { formatDetailValue, formatShortTimestamp, formatTimestamp } from "../../utils.js";

type RemoteState<T> = { data?: T; busy: boolean; error?: string };

const ranges: Array<{ value: HealthDataChartRange; label: string }> = [
  { value: "all", label: "All" },
  { value: "1y", label: "1Y" },
  { value: "3m", label: "3M" },
  { value: "1m", label: "1M" }
];

export function BodyTrendRoute({ activeProfileId, selectedDateFromPath, onSelectDate, onSelectMeasurement }: {
  activeProfileId?: string;
  selectedDateFromPath?: string;
  onSelectDate: (date: string) => void;
  onSelectMeasurement: (code: string) => void;
}) {
  const [range, setRange] = useState<HealthDataChartRange>("all");
  const [selectedDate, setSelectedDate] = useState<string>();
  const [timeline, setTimeline] = useState<RemoteState<BodyTrendTimeline>>({ busy: true });
  const [detail, setDetail] = useState<RemoteState<BodyTrendDateDetail>>({ busy: false });
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  useEffect(() => {
    setSelectedDate(selectedDateFromPath);
  }, [selectedDateFromPath]);

  useEffect(() => {
    const controller = new AbortController();
    setTimeline((current) => ({ ...current, busy: true, error: undefined }));
    void api.bodyTrendTimeline({ range, timezone }, controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      setTimeline({ data, busy: false });
      setSelectedDate((current) => data.points.some((point) => point.date === current) ? current : data.points.at(-1)?.date);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setTimeline({ busy: false, error: error instanceof Error ? error.message : "Unable to load Body Trend." });
    });
    return () => controller.abort();
  }, [activeProfileId, range, timezone]);

  useEffect(() => {
    if (!selectedDate) {
      setDetail({ busy: false });
      return;
    }
    const controller = new AbortController();
    setDetail((current) => ({ ...current, busy: true, error: undefined }));
    void api.bodyTrendDateDetail(selectedDate, { timezone }, controller.signal).then((data) => {
      if (!controller.signal.aborted) setDetail({ data, busy: false });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setDetail({ busy: false, error: error instanceof Error ? error.message : "Unable to load selected reading." });
    });
    return () => controller.abort();
  }, [activeProfileId, selectedDate, timezone]);

  const data = timeline.data;
  return <section className="body-trend-page" aria-labelledby="body-trend-title">
    <header className="body-trend-header">
      <div>
        <h2 id="body-trend-title">Body Trend</h2>
        <p>See how your body composition changes over time.</p>
      </div>
      <div className="summary-detail-chart-toolbar" role="group" aria-label="Body Trend range">
        {ranges.map((option) => <button key={option.value} type="button" className={range === option.value ? "active" : ""} aria-pressed={range === option.value} onClick={() => setRange(option.value)}>{option.label}</button>)}
      </div>
    </header>
    {timeline.busy && !data ? <p className="empty" role="status">Loading Body Trend…</p> : null}
    {timeline.error && !data ? <p className="empty" role="alert">{timeline.error}</p> : null}
    {data?.points.length === 0 ? <div className="body-trend-empty"><h2>Complete readings will appear here</h2><p>Body Trend needs muscle mass or skeletal muscle mass, fat mass, and bone mineral content recorded together in one body-composition reading.</p></div> : null}
    {data?.points.length ? <>
      <BodyTrendChart points={data.points} unit={data.unit} selectedDate={selectedDate} onSelect={(date) => {
        setSelectedDate(date);
        onSelectDate(date);
      }} />
      {data.truncated ? <p className="body-trend-note">Showing the most recent {data.points.length} complete readings.</p> : null}
      <BodyTrendDetail detail={detail} unit={data.unit} onSelectMeasurement={onSelectMeasurement} />
    </> : null}
  </section>;
}

function BodyTrendDetail({ detail, unit, onSelectMeasurement }: { detail: RemoteState<BodyTrendDateDetail>; unit: string; onSelectMeasurement: (code: string) => void }) {
  if (detail.busy && !detail.data) return <p className="empty" role="status">Loading selected reading…</p>;
  if (detail.error && !detail.data) return <p className="empty" role="alert">{detail.error}</p>;
  const selected = detail.data?.selectedSession;
  if (!selected) return null;
  return <section className="body-trend-detail" aria-live="polite">
    <header className="body-trend-detail-heading">
      <h2>{formatTimestamp(selected.observedAt)}</h2>
    </header>
    <div className="body-trend-metrics">
      {selected.metrics.map((metric) => <button key={metric.id} type="button" onClick={() => onSelectMeasurement(metric.measurementCode)}>
        <span>{metric.displayName}</span><strong>{formatDetailValue(metric.value)} <small>{metric.unit || unit}</small></strong>
      </button>)}
    </div>
    {detail.data?.otherReadings.length ? <section className="body-trend-other"><h3>Other body readings that day</h3>{detail.data.otherReadings.map((reading) => <div key={reading.sessionId}><p>{formatTimestamp(reading.observedAt)}</p><ul>{reading.metrics.map((metric) => <li key={metric.id}>{metric.displayName}: {formatDetailValue(metric.value)} {metric.unit}</li>)}</ul></div>)}</section> : null}
  </section>;
}
