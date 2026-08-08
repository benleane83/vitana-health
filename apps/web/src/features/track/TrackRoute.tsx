import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { mergeHealthDataDetail } from "@vitana/shared";
import type {
  HealthDataChartMode,
  HealthDataChartRange,
  HealthDataChartSeries,
  HealthDataDetail,
  HealthDataDetailEntry,
  HealthDataSummary,
  MeasurementType,
  LatestMetric,
  PersonalReferenceRangeInput,
  SleepSessionPage,
  UnitSystem,
  UpdateObservationInput
} from "@vitana/shared";
import { api } from "../../api.js";
import { ObservationEditDialog } from "../../components/ObservationEditDialog.js";
import { ObservationTypeDetailPage, SummaryPage } from "../../pages/SummaryPage.js";
import type { TrackView } from "../../types.js";
import { BodyTrendRoute } from "./BodyTrendRoute.js";
import { CalendarRoute } from "./CalendarRoute.js";
import { JournalRoute } from "./JournalRoute.js";
import { ObservationGroupRoute } from "./ObservationGroupRoute.js";
import { ProLockedView } from "../../components/ProLockedView.js";

type RemoteState<T> = {
  data?: T;
  busy: boolean;
  error?: string;
};

type ConfirmAction = (
  title: string,
  description: string,
  confirmLabel: string,
  destructive: boolean
) => Promise<boolean>;

export function TrackRoute({
  detailCode,
  observationGroupId,
  view,
  activeProfileId,
  measurementTypes,
  units,
  latestMetrics,
  onViewChange,
  bodyTrendDate,
  onSelectBodyTrendDate,
  onBack,
  onSelectDetail,
  onViewObservationGroup,
  onDataChanged,
  onNotice,
  confirm,
  calendarAllowed,
  bodyTrendAllowed
}: {
  detailCode?: string;
  observationGroupId?: string;
  view: TrackView;
  activeProfileId?: string;
  measurementTypes: MeasurementType[];
  units: UnitSystem;
  latestMetrics: LatestMetric[];
  onViewChange: (view: TrackView) => void;
  bodyTrendDate?: string;
  onSelectBodyTrendDate: (date: string) => void;
  onBack: () => void;
  onSelectDetail: (measurementCode: string) => void;
  onViewObservationGroup: (groupId: string) => void;
  onDataChanged: () => Promise<void>;
  onNotice: (message: string) => void;
  confirm: ConfirmAction;
  calendarAllowed: boolean;
  bodyTrendAllowed: boolean;
}) {
  const [summary, setSummary] = useState<RemoteState<HealthDataSummary>>({ busy: true });
  const [detail, setDetail] = useState<RemoteState<HealthDataDetail>>({ busy: false });
  const [chartSeries, setChartSeries] = useState<RemoteState<HealthDataChartSeries>>({ busy: false });
  const [sleepSessions, setSleepSessions] = useState<RemoteState<SleepSessionPage>>({ busy: false });
  const [chartRange, setChartRange] = useState<HealthDataChartRange>("all");
  const [chartMode, setChartMode] = useState<HealthDataChartMode>("auto");
  const [sort, setSort] = useState<"name" | "count" | "recency">("recency");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [actionBusy, setActionBusy] = useState(false);
  const [loadMoreBusy, setLoadMoreBusy] = useState(false);
  const [observationBeingEdited, setObservationBeingEdited] = useState<HealthDataDetailEntry>();
  const defaultUnit = measurementTypes.find((measurement) => measurement.code === detailCode)?.canonicalUnit ?? "";

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, currentView: TrackView) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const views: TrackView[] = ["measurements", "journal", "calendar", "body-trend"];
    const currentIndex = views.indexOf(currentView);
    const resolved = event.key === "Home" ? views[0]! : event.key === "End" ? views.at(-1)! : views[
      (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + views.length) % views.length
    ]!;
    onViewChange(resolved);
    document.getElementById(`track-tab-${resolved}`)?.focus();
  }

  useEffect(() => {
    const controller = new AbortController();
    setSummary((current) => ({ ...current, busy: true, error: undefined }));
    void api.summary(controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      setSummary({ data, busy: false });
      setExpandedCategories(new Set(data.categories.map((category) => category.key)));
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setSummary({
        busy: false,
        error: error instanceof Error ? error.message : "Unable to load summary."
      });
    });
    return () => { controller.abort(); };
  }, [activeProfileId]);

  useEffect(() => {
    if (!detailCode) {
      setDetail({ busy: false });
      return;
    }
    const controller = new AbortController();
    setDetail((current) => ({ ...current, busy: true, error: undefined }));
    void api.healthDataDetail(detailCode, undefined, controller.signal).then((data) => {
      if (!controller.signal.aborted) setDetail({ data, busy: false });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setDetail({
        busy: false,
        error: error instanceof Error ? error.message : "Unable to load detail."
      });
    });
    return () => { controller.abort(); };
  }, [detailCode, activeProfileId]);

  useEffect(() => {
    if (!detailCode) {
      setChartSeries({ busy: false });
      return;
    }
    const controller = new AbortController();
    setChartSeries({ busy: true });
    void api.healthDataChartSeries(detailCode, { range: chartRange, mode: chartMode }, controller.signal).then((data) => {
      if (!controller.signal.aborted) setChartSeries({ data, busy: false });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setChartSeries({
        busy: false,
        error: error instanceof Error ? error.message : "Unable to load trend."
      });
    });
    return () => { controller.abort(); };
  }, [detailCode, activeProfileId, chartRange, chartMode]);

  useEffect(() => {
    if (detailCode !== "sleep_duration") {
      setSleepSessions({ busy: false });
      return;
    }
    const controller = new AbortController();
    setSleepSessions({ busy: true });
    void api.sleepSessions({ limit: 60 }, controller.signal).then((data) => {
      if (!controller.signal.aborted) setSleepSessions({ data, busy: false });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setSleepSessions({
        busy: false,
        error: error instanceof Error ? error.message : "Unable to load sleep stages."
      });
    });
    return () => { controller.abort(); };
  }, [detailCode, activeProfileId]);

  async function refreshAfterMutation(nextDetailCode: string) {
    const [nextSummary, nextDetail, nextChartSeries] = await Promise.all([
      api.summary(),
      api.healthDataDetail(nextDetailCode),
      api.healthDataChartSeries(nextDetailCode, { range: chartRange, mode: chartMode }),
      onDataChanged()
    ]);
    setSummary({ data: nextSummary, busy: false });
    setExpandedCategories(new Set(nextSummary.categories.map((category) => category.key)));
    setDetail({ data: nextDetail, busy: false });
    setChartSeries({ data: nextChartSeries, busy: false });
  }

  async function deleteObservation(entry: HealthDataDetailEntry) {
    if (!entry.canDelete || !detailCode) return;
    const approved = await confirm(
      "Delete observation",
      `Delete ${entry.displayName} observation recorded on ${entry.timestamp}?`,
      "Delete",
      true
    );
    if (!approved) return;
    await runAction(async () => {
      await api.deleteObservation(entry.id);
      await refreshAfterMutation(detailCode);
      onNotice("Observation deleted.");
    });
  }

  async function updateObservation(input: UpdateObservationInput) {
    if (!observationBeingEdited) return;
    await runAction(async () => {
      await api.updateObservation(observationBeingEdited.id, input);
      await refreshAfterMutation(input.measurementCode);
      setObservationBeingEdited(undefined);
      if (detailCode !== input.measurementCode) onSelectDetail(input.measurementCode);
      onNotice("Observation updated.");
    });
  }

  async function addManualObservation(input: { observedAt: string; value: number; unit: string; note: string }) {
    if (!detailCode || !detail.data) return;
    const measurement = detail.data.measurement;
    await runAction(async () => {
      await api.importManualObservations({
        observedAt: input.observedAt,
        label: `Manual ${measurement.displayName}`,
        observations: [{
          measurementName: measurement.displayName,
          measurementCode: detailCode,
          value: input.value,
          unit: input.unit,
          note: input.note || undefined
        }]
      });
      await refreshAfterMutation(detailCode);
      onNotice(`${measurement.displayName} measurement added.`);
    });
  }

  async function setPersonalReferenceRange(input: PersonalReferenceRangeInput) {
    if (!detailCode) return;
    setActionBusy(true);
    try {
      await api.setPersonalReferenceRange(detailCode, input);
      await refreshAfterMutation(detailCode);
      onNotice("Personal reference range saved.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save the reference range.";
      onNotice(message);
      throw error;
    } finally {
      setActionBusy(false);
    }
  }

  async function removePersonalReferenceRange() {
    if (!detailCode) return;
    setActionBusy(true);
    try {
      await api.removePersonalReferenceRange(detailCode);
      await refreshAfterMutation(detailCode);
      onNotice("Personal reference range removed.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to remove the reference range.";
      onNotice(message);
      throw error;
    } finally {
      setActionBusy(false);
    }
  }

  async function deleteAll() {
    if (!detailCode || !detail.data) return;
    const observationCount = detail.data.deletion.observationEntries;
    const approved = await confirm(
      "Delete observations",
      `Delete ${observationCount} ${detail.data.measurement.displayName} observation record(s)?`,
      `Delete ${observationCount}`,
      true
    );
    if (!approved) return;
    await runAction(async () => {
      await api.deleteObservationsByType(detailCode);
      await refreshAfterMutation(detailCode);
      onNotice(observationCount === 1 ? "1 observation deleted." : `${observationCount} observations deleted.`);
    });
  }

  async function runAction(task: () => Promise<void>) {
    setActionBusy(true);
    try {
      await task();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unexpected local error.");
    } finally {
      setActionBusy(false);
    }
  }

  async function setPinned(isPinned: boolean) {
    if (!detailCode || actionBusy) return;
    await runAction(async () => {
      if (isPinned) await api.pinMeasurement(detailCode);
      else await api.unpinMeasurement(detailCode);
      await refreshAfterMutation(detailCode);
      onNotice(isPinned ? "Measurement pinned." : "Measurement unpinned.");
    });
  }

  async function loadMore() {
    if (!detailCode || !detail.data?.pagination.hasMore) return;
    setLoadMoreBusy(true);
    setDetail((current) => ({ ...current, error: undefined }));
    try {
      const nextPage = await api.healthDataDetail(detailCode, {
        limit: detail.data.pagination.limit,
        offset: detail.data.pagination.loaded
      });
      setDetail((current) => {
        if (!current.data) return { data: nextPage, busy: false };
        return {
          busy: false,
          data: mergeHealthDataDetail(current.data, nextPage)
        };
      });
    } catch (error) {
      setDetail((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Unable to load more entries."
      }));
    } finally {
      setLoadMoreBusy(false);
    }
  }

  function toggleCategory(key: string) {
    setExpandedCategories((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <section className="track-page" aria-labelledby="track-title" aria-describedby="track-description">
      <header className="route-page-header">
        <div>
          <h1 id="track-title">Track</h1>
          <p id="track-description" className="route-page-description">Review measurements, daily activity, health events, and body composition over time.</p>
        </div>
      </header>
      <div className="care-switch track-switch route-local-nav" role="tablist" aria-label="Track views" aria-orientation="horizontal">
        {(["measurements", "journal", "calendar", "body-trend"] as const).map((value) => (
          <button
            key={value}
            id={`track-tab-${value}`}
            type="button"
            role="tab"
            aria-selected={view === value}
            aria-controls="track-view-panel"
            tabIndex={view === value ? 0 : -1}
            className={view === value ? "active" : ""}
            onClick={() => onViewChange(value)}
            onKeyDown={(event) => handleTabKeyDown(event, value)}
          >
            {value === "measurements" ? "Measurements" : value === "body-trend" ? "Body Trend" : value === "calendar" ? "Calendar" : "Journal"}
          </button>
        ))}
      </div>
      <div id="track-view-panel" role="tabpanel" aria-labelledby={`track-tab-${view}`}>
      {view === "body-trend" && !bodyTrendAllowed ? (
        <ProLockedView feature="Body Trend" />
      ) : view === "calendar" && !calendarAllowed ? (
        <ProLockedView feature="Calendar" />
      ) : view === "body-trend" ? (
        <BodyTrendRoute
          activeProfileId={activeProfileId}
          selectedDateFromPath={bodyTrendDate}
          onSelectDate={onSelectBodyTrendDate}
          onSelectMeasurement={onSelectDetail}
        />
      ) : view === "calendar" ? (
        <CalendarRoute
          activeProfileId={activeProfileId}
          measurementTypes={measurementTypes}
          latestMetrics={latestMetrics}
          recordedCodes={summary.data?.categories.flatMap((category) => category.rows.map((row) => row.code)) ?? []}
        />
      ) : view === "journal" ? (
        <JournalRoute activeProfileId={activeProfileId} />
      ) : observationGroupId ? (
        <ObservationGroupRoute
          groupId={observationGroupId}
          activeProfileId={activeProfileId}
          measurementTypes={measurementTypes}
          units={units}
          onBack={onBack}
          onSelectMeasurement={onSelectDetail}
          onDataChanged={onDataChanged}
          onNotice={onNotice}
        />
      ) : detailCode ? (
        <ObservationTypeDetailPage
          key={`${activeProfileId ?? ""}:${detailCode}`}
          detail={detail.data}
          chartSeries={chartSeries.data}
          chartRange={chartRange}
          chartMode={chartMode}
          chartBusy={chartSeries.busy}
          chartError={chartSeries.error}
          sleepSessions={sleepSessions.data}
          sleepSessionsBusy={sleepSessions.busy}
          sleepSessionsError={sleepSessions.error}
          loading={detail.busy}
          error={detail.error}
          actionBusy={actionBusy}
          loadMoreBusy={loadMoreBusy}
          onBack={onBack}
          onEditObservation={setObservationBeingEdited}
          onViewObservationGroup={onViewObservationGroup}
          onDeleteObservation={deleteObservation}
          onDeleteAll={deleteAll}
          onLoadMore={loadMore}
          onChartRangeChange={setChartRange}
          onChartModeChange={setChartMode}
          onAddManualObservation={addManualObservation}
          onSetPersonalReferenceRange={setPersonalReferenceRange}
          onRemovePersonalReferenceRange={removePersonalReferenceRange}
          onSetPinned={setPinned}
          measurementType={measurementTypes.find((measurement) => measurement.code === detailCode)}
          defaultUnit={defaultUnit}
        />
      ) : (
        <SummaryPage
          summary={summary.data}
          loading={summary.busy}
          error={summary.error}
          sort={sort}
          onSortChange={setSort}
          expandedCategories={expandedCategories}
          onToggleCategory={toggleCategory}
          onSelectRow={onSelectDetail}
        />
      )}
      </div>
      {observationBeingEdited ? (
        <ObservationEditDialog
          entry={observationBeingEdited}
          measurementTypes={measurementTypes}
          busy={actionBusy}
          onClose={() => setObservationBeingEdited(undefined)}
          onSave={updateObservation}
        />
      ) : null}
    </section>
  );
}