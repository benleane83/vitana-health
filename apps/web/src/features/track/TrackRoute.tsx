import { useEffect, useState } from "react";
import type {
  HealthDataDetail,
  HealthDataDetailEntry,
  HealthDataSummary,
  MeasurementType,
  UpdateObservationInput
} from "@local-fitness-advisor/shared";
import { api } from "../../api.js";
import { ObservationEditDialog } from "../../components/ObservationEditDialog.js";
import { ObservationTypeDetailPage, SummaryPage } from "../../pages/SummaryPage.js";

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
  activeProfileId,
  measurementTypes,
  onBack,
  onSelectDetail,
  onDataChanged,
  onNotice,
  confirm
}: {
  detailCode?: string;
  activeProfileId?: string;
  measurementTypes: MeasurementType[];
  onBack: () => void;
  onSelectDetail: (measurementCode: string) => void;
  onDataChanged: () => Promise<void>;
  onNotice: (message: string) => void;
  confirm: ConfirmAction;
}) {
  const [summary, setSummary] = useState<RemoteState<HealthDataSummary>>({ busy: true });
  const [detail, setDetail] = useState<RemoteState<HealthDataDetail>>({ busy: false });
  const [sort, setSort] = useState<"name" | "count" | "recency">("recency");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [actionBusy, setActionBusy] = useState(false);
  const [loadMoreBusy, setLoadMoreBusy] = useState(false);
  const [observationBeingEdited, setObservationBeingEdited] = useState<HealthDataDetailEntry>();

  useEffect(() => {
    let cancelled = false;
    setSummary((current) => ({ ...current, busy: true, error: undefined }));
    void api.summary().then((data) => {
      if (cancelled) return;
      setSummary({ data, busy: false });
      setExpandedCategories(new Set(data.categories.map((category) => category.key)));
    }).catch((error: unknown) => {
      if (!cancelled) setSummary({
        busy: false,
        error: error instanceof Error ? error.message : "Unable to load summary."
      });
    });
    return () => { cancelled = true; };
  }, [activeProfileId]);

  useEffect(() => {
    if (!detailCode) {
      setDetail({ busy: false });
      return;
    }
    let cancelled = false;
    setDetail((current) => ({ ...current, busy: true, error: undefined }));
    void api.healthDataDetail(detailCode).then((data) => {
      if (!cancelled) setDetail({ data, busy: false });
    }).catch((error: unknown) => {
      if (!cancelled) setDetail({
        busy: false,
        error: error instanceof Error ? error.message : "Unable to load detail."
      });
    });
    return () => { cancelled = true; };
  }, [detailCode, activeProfileId]);

  async function refreshAfterMutation(nextDetailCode: string) {
    const [nextSummary, nextDetail] = await Promise.all([
      api.summary(),
      api.healthDataDetail(nextDetailCode),
      onDataChanged()
    ]);
    setSummary({ data: nextSummary, busy: false });
    setExpandedCategories(new Set(nextSummary.categories.map((category) => category.key)));
    setDetail({ data: nextDetail, busy: false });
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
          data: {
            ...nextPage,
            entries: [...current.data.entries, ...nextPage.entries],
            chartPoints: [...current.data.chartPoints, ...nextPage.chartPoints].sort(
              (left, right) => left.timestamp.localeCompare(right.timestamp) || left.kind.localeCompare(right.kind)
            )
          }
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
    <>
      {detailCode ? (
        <ObservationTypeDetailPage
          detail={detail.data}
          loading={detail.busy}
          error={detail.error}
          actionBusy={actionBusy}
          loadMoreBusy={loadMoreBusy}
          onBack={onBack}
          onEditObservation={setObservationBeingEdited}
          onDeleteObservation={deleteObservation}
          onDeleteAll={deleteAll}
          onLoadMore={loadMore}
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
      {observationBeingEdited ? (
        <ObservationEditDialog
          entry={observationBeingEdited}
          measurementTypes={measurementTypes}
          busy={actionBusy}
          onClose={() => setObservationBeingEdited(undefined)}
          onSave={updateObservation}
        />
      ) : null}
    </>
  );
}