import type { SleepSession, SleepSessionPage, SleepSessionStage } from "@vitana/shared";
import { formatShortTimestamp } from "../utils.js";

const stageRows: Array<{ stage: Exclude<SleepSessionStage["stage"], "gap">; label: string; y: number }> = [
  { stage: "awake", label: "Awake", y: 16 },
  { stage: "rem", label: "REM", y: 58 },
  { stage: "light", label: "Light", y: 100 },
  { stage: "deep", label: "Deep", y: 142 }
];

const chartLeft = 94;
const chartWidth = 626;
const rowHeight = 29;

function formatNight(session: SleepSession): string {
  return formatShortTimestamp(session.startAt);
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.round(minutes % 60);
  return hours > 0 ? `${hours}h ${remainingMinutes}m` : `${remainingMinutes}m`;
}

function stageLabel(stage: SleepSessionStage["stage"]): string {
  return { awake: "Awake", rem: "REM", light: "Light", deep: "Deep", gap: "Unclassified" }[stage];
}

function sessionDescription(session: SleepSession): string {
  if (session.stageDataStatus === "unavailable") return "Stage data is unavailable for this night.";
  if (session.stageDataStatus === "partial") return "Some intervals could not be classified and are shown as gaps.";
  return "Complete stage data is available for this night.";
}

export function HypnogramPanel({
  page,
  busy,
  error,
  selectedSessionId
}: {
  page?: SleepSessionPage;
  busy: boolean;
  error?: string;
  selectedSessionId?: string;
}) {
  const sessions = page?.sessions ?? [];
  const selected = sessions.find((session) => session.id === selectedSessionId) ?? sessions[0];

  return (
    <section id="hypnogram-panel" className="hypnogram-panel" aria-labelledby="hypnogram-heading" aria-busy={busy && !page}>
      <div className="summary-detail-section-heading hypnogram-heading">
        <div>
          <h3 id="hypnogram-heading">Sleep stages</h3>
          {selected ? (
            <p className="hypnogram-subtitle">
              {selected.title ?? formatNight(selected)} · {formatDuration(selected.durationMinutes)}
            </p>
          ) : null}
        </div>
      </div>

      {busy && !page ? <div className="hypnogram-skeleton" aria-hidden="true"><span /><span /><span /><span /></div> : null}
      {error && !page ? <p className="empty" role="alert">{error}</p> : null}
      {!busy && !error && sessions.length === 0 ? (
        <p className="empty">Sleep stages appear after Health Connect sends a sleep session with stage intervals.</p>
      ) : null}
      {selected ? <Hypnogram session={selected} /> : null}
    </section>
  );
}

function Hypnogram({ session }: { session: SleepSession }) {
  const sessionStart = Date.parse(session.startAt);
  const sessionEnd = Date.parse(session.endAt);
  const sessionLength = Math.max(1, sessionEnd - sessionStart);
  const statusLabel = session.stageDataStatus === "available" ? "Available" : session.stageDataStatus === "partial" ? "Partial" : "Unavailable";

  if (session.stageDataStatus === "unavailable") {
    return <p className="hypnogram-empty" role="status">Stage data is unavailable for this night.</p>;
  }

  return (
    <>
      <div className="hypnogram-status">
        <span className={`hypnogram-status-badge is-${session.stageDataStatus}`}>{statusLabel}</span>
        <span>{sessionDescription(session)}</span>
      </div>
      <svg
        className="hypnogram-chart"
        viewBox="0 0 760 195"
        role="img"
        aria-labelledby={`hypnogram-title-${session.id} hypnogram-description-${session.id}`}
      >
        <title id={`hypnogram-title-${session.id}`}>Sleep stages for {formatNight(session)}</title>
        <desc id={`hypnogram-description-${session.id}`}>{sessionDescription(session)}</desc>
        {stageRows.map((row) => (
          <g key={row.stage}>
            <line className="hypnogram-gridline" x1={chartLeft} x2={chartLeft + chartWidth} y1={row.y + rowHeight} y2={row.y + rowHeight} />
            <text className="hypnogram-row-label" x={chartLeft - 12} y={row.y + 19} textAnchor="end">{row.label}</text>
          </g>
        ))}
        {session.stages.map((stage, index) => {
          const start = Date.parse(stage.startAt);
          const end = Date.parse(stage.endAt);
          const x = chartLeft + ((start - sessionStart) / sessionLength) * chartWidth;
          const width = Math.max(1, ((end - start) / sessionLength) * chartWidth);
          if (stage.stage === "gap") {
            return <rect key={`${stage.startAt}-${index}`} className="hypnogram-gap" x={x} y={10} width={width} height={163} />;
          }
          const row = stageRows.find((candidate) => candidate.stage === stage.stage)!;
          return (
            <rect
              key={`${stage.startAt}-${index}`}
              className={`hypnogram-stage is-${stage.stage}`}
              x={x}
              y={row.y}
              width={width}
              height={rowHeight}
            >
              <title>{`${stageLabel(stage.stage)}: ${formatShortTimestamp(stage.startAt)} to ${formatShortTimestamp(stage.endAt)}`}</title>
            </rect>
          );
        })}
        <line className="hypnogram-axis" x1={chartLeft} x2={chartLeft + chartWidth} y1={174} y2={174} />
        <text className="hypnogram-time-label" x={chartLeft} y={190}>{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(session.startAt))}</text>
        <text className="hypnogram-time-label" x={chartLeft + chartWidth} y={190} textAnchor="end">{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(session.endAt))}</text>
      </svg>
      <ul className="hypnogram-legend" aria-label="Sleep stage legend">
        {stageRows.map((row) => <li key={row.stage}><span className={`hypnogram-legend-swatch is-${row.stage}`} />{row.label}</li>)}
        {session.stageDataStatus === "partial" ? <li><span className="hypnogram-legend-swatch is-gap" />Unclassified</li> : null}
      </ul>
      <details className="sr-only">
        <summary>Sleep stage intervals</summary>
        <ul>{session.stages.map((stage, index) => <li key={`${stage.startAt}-${index}`}>{stageLabel(stage.stage)} from {formatShortTimestamp(stage.startAt)} to {formatShortTimestamp(stage.endAt)}</li>)}</ul>
      </details>
    </>
  );
}