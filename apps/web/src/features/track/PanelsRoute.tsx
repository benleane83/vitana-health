import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  observationGroupKindLabel,
  type ObservationGroupKind,
  type ObservationGroupListItem,
  type ObservationGroupListQuery,
  type PaginatedResult
} from "@vitana/shared";
import { api } from "../../api.js";

const pageSize = 50;
const groupKinds: ObservationGroupKind[] = [
  "lab_panel",
  "body_composition_report",
  "activity_session",
  "import_batch",
  "custom"
];

type Filters = Pick<ObservationGroupListQuery, "kinds" | "dateFrom" | "dateTo">;
type RemoteState = {
  data?: PaginatedResult<ObservationGroupListItem>;
  busy: boolean;
  error?: string;
  moreError?: string;
};

export function PanelsRoute({
  activeProfileId,
  onViewObservationGroup
}: {
  activeProfileId?: string;
  onViewObservationGroup: (groupId: string) => void;
}) {
  const [filters, setFilters] = useState<Filters>({});
  const [state, setState] = useState<RemoteState>({ busy: true });
  const [retryToken, setRetryToken] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const moreRequest = useRef<AbortController | null>(null);
  const invalidRange = Boolean(filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo);

  useEffect(() => {
    if (invalidRange) return;
    const controller = new AbortController();
    moreRequest.current?.abort();
    setState({ busy: true });
    void api.observationGroups({ ...filters, limit: pageSize, offset: 0 }, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ data, busy: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({
          busy: false,
          error: "We couldn't load your panels. Please try again."
        });
      });
    return () => {
      controller.abort();
      moreRequest.current?.abort();
    };
  }, [activeProfileId, filters, invalidRange, retryToken]);

  async function loadMore() {
    if (!state.data?.hasMore || loadingMore || invalidRange) return;
    moreRequest.current?.abort();
    const controller = new AbortController();
    moreRequest.current = controller;
    setLoadingMore(true);
    try {
      const next = await api.observationGroups({
        ...filters,
        limit: pageSize,
        offset: state.data.items.length
      }, controller.signal);
      if (controller.signal.aborted) return;
      setState((current) => current.data ? {
        busy: false,
        data: {
          ...next,
          items: [...current.data.items, ...next.items]
        }
      } : current);
    } catch {
      if (!controller.signal.aborted) {
        setState((current) => ({ ...current, moreError: "We couldn't load more panels. Please try again." }));
      }
    } finally {
      if (moreRequest.current === controller) setLoadingMore(false);
    }
  }

  const hasFilters = Boolean(filters.kinds?.length || filters.dateFrom || filters.dateTo);
  const items = state.data?.items ?? [];

  return (
    <section className="panels-page" aria-labelledby="panels-title" aria-busy={state.busy}>
      <header className="panels-header">
        <div>
          <h2 id="panels-title">Panels</h2>
          <p>Find measurement panels and grouped records by type and date.</p>
        </div>
      </header>
      <div className="panels-filters" aria-label="Panel filters">
        <label>
          Type
          <select
            value={filters.kinds?.[0] ?? ""}
            onChange={(event) => setFilters((current) => ({
              ...current,
              kinds: event.target.value ? [event.target.value as ObservationGroupKind] : undefined
            }))}
          >
            <option value="">All types</option>
            {groupKinds.map((kind) => <option key={kind} value={kind}>{observationGroupKindLabel(kind)}</option>)}
          </select>
        </label>
        <label>
          From
          <input
            type="date"
            value={filters.dateFrom ?? ""}
            max={filters.dateTo}
            onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value || undefined }))}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={filters.dateTo ?? ""}
            min={filters.dateFrom}
            onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value || undefined }))}
          />
        </label>
        <button type="button" disabled={!hasFilters} onClick={() => setFilters({})}>Clear filters</button>
      </div>
      {invalidRange ? <p className="panels-message" role="alert">The From date must be on or before the To date.</p> : null}
      {state.busy && !invalidRange ? <p className="panels-message">Loading panels…</p> : null}
      {state.error && !invalidRange ? (
        <div className="panels-message" role="alert">
          <p>{state.error}</p>
          <button type="button" onClick={() => setRetryToken((value) => value + 1)}>Retry</button>
        </div>
      ) : null}
      {!state.busy && !state.error && !invalidRange && items.length === 0 ? (
        <div className="panels-message">
          <h2>{hasFilters ? "No matching panels" : "No panels yet"}</h2>
          <p>{hasFilters ? "Try clearing or changing the filters." : "Grouped measurements appear here after you add or sync them."}</p>
        </div>
      ) : null}
      {items.length > 0 && !invalidRange ? (
        <div className="panels-results">
          {items.map((item) => (
            <div className="panel-row" key={item.id}>
              <button
                type="button"
                className="panel-row-open"
                onClick={() => onViewObservationGroup(item.id)}
                aria-label={`Open ${item.label}`}
              >
                <span className="panel-row-main">
                  <strong>{item.label}</strong>
                  <span>{observationGroupKindLabel(item.kind)}</span>
                </span>
                <span className="panel-row-meta">
                  <time dateTime={item.date}>{formatPanelDate(item.date)}</time>
                  <span>{item.measurementCount} {item.measurementCount === 1 ? "measurement" : "measurements"}</span>
                </span>
                <ChevronRight size={20} aria-hidden="true" />
              </button>
            </div>
          ))}
          {state.moreError ? <p className="panels-more-error" role="alert">{state.moreError}</p> : null}
          {state.data?.hasMore ? (
            <button className="panels-load-more" type="button" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? "Loading…" : state.moreError ? "Retry loading more" : "Load more"}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function formatPanelDate(value: string | undefined): string {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}
