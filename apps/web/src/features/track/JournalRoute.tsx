import { useEffect, useRef, useState } from "react";
import { BedDouble, ClipboardCheck, Footprints } from "lucide-react";
import type { JournalPage, JournalTimelineItem } from "@vitana/shared";
import { api } from "../../api.js";

type RemoteState = {
  data?: JournalPage;
  busy: boolean;
  error?: string;
  olderError?: string;
};

const journalDayLimit = 14;

export function JournalRoute({ activeProfileId }: { activeProfileId?: string }) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [state, setState] = useState<RemoteState>({ busy: true });
  const [retryToken, setRetryToken] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const olderRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    olderRequest.current?.abort();
    setState({ busy: true });
    void api.journal({ timezone, dayLimit: journalDayLimit }, controller.signal).then((data) => {
      if (!controller.signal.aborted) setState({ data, busy: false });
    }).catch(() => {
      if (!controller.signal.aborted) setState({
        busy: false,
        error: "We couldn't load your Journal. Please try again."
      });
    });
    return () => {
      controller.abort();
      olderRequest.current?.abort();
    };
  }, [activeProfileId, retryToken, timezone]);

  async function loadOlderDays() {
    const beforeDate = state.data?.nextBeforeDate;
    if (!beforeDate || loadingOlder) return;
    olderRequest.current?.abort();
    const controller = new AbortController();
    olderRequest.current = controller;
    setLoadingOlder(true);
    try {
      const older = await api.journal({ timezone, dayLimit: journalDayLimit, beforeDate }, controller.signal);
      if (controller.signal.aborted) return;
      setState((current) => current.data ? {
        busy: false,
        data: {
          ...older,
          days: [...current.data.days, ...older.days]
        },
        olderError: undefined
      } : current);
    } catch {
      if (controller.signal.aborted) return;
      setState((current) => current.data ? {
        ...current,
        olderError: "We couldn't load older days. Check your connection and try again."
      } : current);
    } finally {
      if (olderRequest.current === controller) setLoadingOlder(false);
    }
  }

  const days = state.data?.days ?? [];
  return (
    <section className="journal-page" aria-busy={state.busy} aria-labelledby="journal-title">
      <header className="journal-header">
        <div>
          <h2 id="journal-title">Journal</h2>
          <p>Your activity, sleep, and health events, day by day.</p>
        </div>
      </header>
      {state.busy ? <JournalSkeleton /> : null}
      {state.error ? (
        <div className="journal-message" role="alert">
          <p>{state.error}</p>
          <button type="button" onClick={() => setRetryToken((value) => value + 1)}>Retry</button>
        </div>
      ) : null}
      {!state.busy && !state.error && days.length === 0 ? (
        <div className="journal-message">
          <h2>Nothing recorded yet</h2>
          <p>Activity, sleep, and health events appear here after you add or sync them.</p>
        </div>
      ) : null}
      {days.map((day) => (
        <article className="journal-day" key={day.date}>
          <header className="journal-day-header">
            <h2><time dateTime={day.date}>{formatDay(day.date, timezone)}</time></h2>
            <div className="journal-summary" aria-label="Daily summary">
              {day.summary.steps ? <span>{formatNumber(day.summary.steps.value)} steps</span> : null}
              {day.summary.sleepDurationMinutes ? <span>{formatDuration(day.summary.sleepDurationMinutes)} sleep</span> : null}
            </div>
          </header>
          <ul className="journal-items">
            {day.items.map((item) => <JournalItem key={`${item.kind}:${item.id}`} item={item} timezone={timezone} />)}
          </ul>
          {day.omittedItemCount ? <p className="journal-omitted">This day is unusually busy. {day.omittedItemCount} more records are not shown here to keep the Journal easy to scan.</p> : null}
        </article>
      ))}
      {state.data?.nextBeforeDate ? (
        <div className="journal-load-more">
          {state.olderError ? <p role="alert">{state.olderError}</p> : null}
          <button type="button" onClick={() => void loadOlderDays()} disabled={loadingOlder}>
            {loadingOlder ? "Loading older days..." : state.olderError ? "Try loading older days again" : "Load older days"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function JournalItem({ item, timezone }: { item: JournalTimelineItem; timezone: string }) {
  const Icon = item.kind === "activity" ? Footprints : item.kind === "sleep" ? BedDouble : ClipboardCheck;
  const detail = item.kind === "activity"
    ? [item.durationMinutes === undefined ? undefined : formatDuration(item.durationMinutes),
      item.distanceMeters === undefined ? undefined : `${formatNumber(item.distanceMeters / 1000)} km`,
      item.energyKcal === undefined ? undefined : `${formatNumber(item.energyKcal)} kcal`].filter(Boolean).join(" | ")
    : item.kind === "sleep"
      ? `${formatDuration(item.durationMinutes)} | ${formatTime(item.startAt, timezone)} to ${formatTime(item.endAt, timezone)}`
      : item.detail;
  return (
    <li className={`journal-item journal-item-${item.kind}`}>
      <div className="journal-item-time"><time dateTime={item.occurredAt}>{formatTime(item.occurredAt, timezone)}</time></div>
      <div className="journal-item-content">
        <span className="journal-item-icon" aria-hidden="true"><Icon aria-hidden="true" size={17} strokeWidth={2.25} /></span>
        <div>
          <p className="journal-item-title">{item.kind === "sleep" ? "Sleep" : item.title}</p>
          <p className="journal-item-detail">{detail || (item.kind === "health-event" ? item.eventKind : item.kind === "activity" ? item.activityType : "Sleep session")}</p>
        </div>
      </div>
    </li>
  );
}

function JournalSkeleton() {
  return <div className="journal-skeleton" aria-label="Loading Journal"><span /><span /><span /></div>;
}

function formatDay(date: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: timezone, weekday: "long", month: "long", day: "numeric", year: "numeric" })
    .format(new Date(`${date}T12:00:00Z`));
}

function formatTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);
  return hours ? `${hours}h ${remainder}m` : `${remainder}m`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}
