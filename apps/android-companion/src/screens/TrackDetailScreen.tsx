import { Fragment, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";
import DateTimePicker from "@react-native-community/datetimepicker";
import { ChevronRight, CalendarDays, Clock3 } from "lucide-react-native";
import {
  calendarDateToUtcMidnight,
  calculateChartDomain,
  isUtcMidnightTimestamp,
  localCalendarDate,
  localDateFromCalendarDate,
  mergeHealthDataDetail,
  observationCalendarDate,
  usesDateOnlyObservation,
  type HealthDataChartMode,
  type HealthDataChartRange,
  type HealthDataChartSeries,
  type HealthDataDetail,
  type HealthDataDetailEntry
} from "@vitana/shared";
import { useMobileApi } from "../MobileApiProvider";
import type { RootStackParamList } from "../navigationTypes";
import { Button, Card, Loading, Message, Screen } from "../ui/components";
import { colors, spacing } from "../ui/theme";
import { userFacingError } from "../userFacingError";

type Props = NativeStackScreenProps<RootStackParamList, "TrackDetail">;
type ReadingDraft = { observedAt: Date; value: string; unit: string; note: string };

export function TrackDetailScreen({ route }: Props) {
  const {
    connectionState,
    deleteObservation,
    healthDataChartSeries,
    healthDataDetail,
    importManualObservations,
    refreshTrack,
    updateObservation
  } = useMobileApi();
  const [detail, setDetail] = useState<HealthDataDetail>();
  const [chartSeries, setChartSeries] = useState<HealthDataChartSeries>();
  const [chartRange, setChartRange] = useState<HealthDataChartRange>("all");
  const [chartMode, setChartMode] = useState<HealthDataChartMode>("auto");
  const [chartLoading, setChartLoading] = useState(true);
  const [chartError, setChartError] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [selectedEntryId, setSelectedEntryId] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<HealthDataDetailEntry>();
  const [pendingDeletion, setPendingDeletion] = useState<HealthDataDetailEntry>();
  const [actionFeedback, setActionFeedback] = useState<{ entryId?: string; detail: string; title: string; tone: "success" | "danger" }>();
  const [draft, setDraft] = useState<ReadingDraft>({ observedAt: new Date(), value: "", unit: "", note: "" });
  const deletionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let current = true;
    setDetail(undefined);
    setLoading(true);
    setError(undefined);
    setSelectedEntryId(undefined);
    setAdding(false);
    setEditing(undefined);
    setPendingDeletion(undefined);
    setActionFeedback(undefined);
    void healthDataDetail(route.params.measurementCode).then((value) => {
      if (current) setDetail(value);
    }).catch((caught: unknown) => {
      if (current) setError(userFacingError(caught, "Unable to load this metric. Try again."));
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [healthDataDetail, route.params.measurementCode]);

  useEffect(() => {
    let current = true;
    setChartSeries(undefined);
    setChartLoading(true);
    setChartError(undefined);
    void healthDataChartSeries(route.params.measurementCode, { range: chartRange, mode: chartMode }).then((value) => {
      if (current) setChartSeries(value);
    }).catch((caught: unknown) => {
      if (current) setChartError(userFacingError(caught, "Unable to load this trend. Try again."));
    }).finally(() => {
      if (current) setChartLoading(false);
    });
    return () => { current = false; };
  }, [chartMode, chartRange, healthDataChartSeries, route.params.measurementCode]);

  useEffect(() => () => {
    if (deletionTimer.current) clearTimeout(deletionTimer.current);
  }, []);

  useEffect(() => {
    if (connectionState === "online") return;
    setAdding(false);
    setEditing(undefined);
    setSelectedEntryId(undefined);
  }, [connectionState]);

  async function loadMore() {
    if (loadingMore || !detail?.pagination.hasMore) return;
    setError(undefined);
    setLoadingMore(true);
    try {
      const next = await healthDataDetail(route.params.measurementCode, {
        limit: detail.pagination.limit,
        offset: detail.pagination.loaded
      });
      setDetail((current) => current ? mergeHealthDataDetail(current, next) : next);
    } catch (caught) {
      setError(userFacingError(caught, "Unable to load more history. Try again."));
    } finally {
      setLoadingMore(false);
    }
  }

  function beginEdit(entry: HealthDataDetailEntry) {
      setAdding(false);
      setEditing(entry);
      const dateOnly = usesDateOnlyObservation(detail?.measurement.aggregation);
      setDraft({
        observedAt: dateOnly
          ? localDateFromCalendarDate(observationCalendarDate(entry.timestamp)) ?? new Date(entry.timestamp)
          : new Date(entry.timestamp),
        value: String(entry.value),
        unit: entry.unit,
        note: entry.note ?? ""
      });
      setActionFeedback(undefined);
    }

  function beginAdd() {
      setEditing(undefined);
      setSelectedEntryId(undefined);
      setDraft({ observedAt: new Date(), value: "", unit: detail?.entries[0]?.unit ?? "", note: "" });
      setActionFeedback(undefined);
      setAdding(true);
    }

    async function refreshAfterMutation(message: string, entryId?: string, title = "Updated") {
      const [next, nextChartSeries] = await Promise.all([
        healthDataDetail(route.params.measurementCode),
        healthDataChartSeries(route.params.measurementCode, { range: chartRange, mode: chartMode })
      ]);
      setDetail(next);
      setChartSeries(nextChartSeries);
      setActionFeedback({ entryId, detail: message, title, tone: "success" });
      await refreshTrack();
    }

  async function saveEdit() {
      if (!editing) return;
      const value = Number(draft.value);
      const dateOnly = usesDateOnlyObservation(detail?.measurement.aggregation);
      if (!Number.isFinite(value) || !draft.unit.trim() || !Number.isFinite(draft.observedAt.getTime())) {
        setActionFeedback({ entryId: editing.id, detail: `${dateOnly ? "Choose a date" : "Choose a date and time"}, then enter a numeric value and unit.`, title: "Invalid reading", tone: "danger" });
        return;
      }
      setActionBusy(true);
      setActionFeedback(undefined);
      try {
        await updateObservation(editing.id, {
          measurementCode: editing.measurementCode,
          observedAt: serializeObservedAt(draft.observedAt, dateOnly),
          value,
          unit: draft.unit.trim(),
          note: draft.note.trim() || undefined
        });
        setEditing(undefined);
        await refreshAfterMutation("Reading updated.", editing.id);
      } catch (caught) {
        setActionFeedback({
          entryId: editing.id,
          detail: userFacingError(caught, "Unable to update this reading. Try again."),
          title: "Could not update reading",
          tone: "danger"
        });
      } finally {
        setActionBusy(false);
      }
    }

  async function saveNewReading() {
      if (!detail) return;
      const value = Number(draft.value);
      const unit = draft.unit.trim();
      const dateOnly = usesDateOnlyObservation(detail.measurement.aggregation);
      if (!Number.isFinite(value) || !unit || !Number.isFinite(draft.observedAt.getTime())) {
        setActionFeedback({ detail: `${dateOnly ? "Choose a date" : "Choose a date and time"}, then enter a numeric value and unit.`, title: "Invalid reading", tone: "danger" });
        return;
      }
      const observedAt = serializeObservedAt(draft.observedAt, dateOnly);
      setActionBusy(true);
      setActionFeedback(undefined);
      try {
        await importManualObservations({
          observedAt,
          label: `Manual ${detail.measurement.displayName}`,
          observations: [{
            measurementName: detail.measurement.displayName,
            measurementCode: detail.measurement.code,
            value,
            unit,
            note: draft.note.trim() || undefined
          }]
        });
        const [next, nextChartSeries] = await Promise.all([
          healthDataDetail(route.params.measurementCode),
          healthDataChartSeries(route.params.measurementCode, { range: chartRange, mode: chartMode })
        ]);
        const addedEntry = next.entries.find((entry) =>
          entry.kind === "observation" &&
          entry.timestamp === observedAt &&
          entry.value === value &&
          entry.unit === unit
        );
        setDetail(next);
        setChartSeries(nextChartSeries);
        setAdding(false);
        setSelectedEntryId(addedEntry?.id);
        setActionFeedback({
          entryId: addedEntry?.id,
          detail: `${detail.measurement.displayName} measurement added.`,
          title: "Reading added",
          tone: "success"
        });
        await refreshTrack();
      } catch (caught) {
        setActionFeedback({
          detail: userFacingError(caught, "Unable to add this reading. Try again."),
          title: "Could not add reading",
          tone: "danger"
        });
      } finally {
        setActionBusy(false);
      }
    }

  function stageDeletion(entry: HealthDataDetailEntry) {
      setEditing(undefined);
      setSelectedEntryId(undefined);
      setActionFeedback(undefined);
      setPendingDeletion(entry);
      deletionTimer.current = setTimeout(() => { void commitDeletion(entry); }, 6000);
    }

  function cancelDeletion() {
      if (!pendingDeletion) return;
      if (deletionTimer.current) clearTimeout(deletionTimer.current);
      deletionTimer.current = undefined;
      const entry = pendingDeletion;
      setPendingDeletion(undefined);
      setSelectedEntryId(entry.id);
      setActionFeedback({ entryId: entry.id, detail: "Deletion cancelled.", title: "Deletion cancelled", tone: "success" });
    }

  async function commitDeletion(entry: HealthDataDetailEntry) {
      deletionTimer.current = undefined;
      setActionBusy(true);
      try {
        await deleteObservation(entry.id);
        setPendingDeletion(undefined);
        await refreshAfterMutation("Reading deleted.", undefined, "Reading deleted");
      } catch (caught) {
        setPendingDeletion(undefined);
        setActionFeedback({
          entryId: entry.id,
          detail: userFacingError(caught, "Unable to delete this reading. Try again."),
          title: "Could not delete reading",
          tone: "danger"
        });
      } finally {
        setActionBusy(false);
    }
  }

  if (loading) return <Screen><Loading label="Loading metric…" /></Screen>;
  if (!detail) return <Screen><Message title="Metric unavailable" detail={error} /></Screen>;
  const latest = detail.entries[0];
  const visibleEntries = detail.entries.filter((entry) => entry.id !== pendingDeletion?.id);
  const readOnly = connectionState !== "online";
  const hasEditableEntries = !readOnly && visibleEntries.some((entry) => entry.kind === "observation" && entry.canDelete);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.titleRow}>
          <View style={styles.flex}>
            <Text style={styles.title}>{detail.measurement.displayName}</Text>
            {detail.measurement.description ? <Text style={styles.meta}>{detail.measurement.description}</Text> : null}
          </View>
          {!adding && !readOnly ? <Button disabled={actionBusy || Boolean(pendingDeletion)} onPress={beginAdd}>Add reading</Button> : null}
        </View>
        {readOnly ? <Message title="Read-only cached data" detail="Reconnect to your paired PC to add or edit readings." /> : null}
        {latest ? (
          <Card>
            <Text style={styles.label}>Latest</Text>
            <View style={styles.latestRow}>
              <Text adjustsFontSizeToFit numberOfLines={1} style={styles.latest}>{latest.value} {latest.unit}</Text>
              <ReadingStatus entry={latest} />
            </View>
            <Text style={styles.meta}>{formatTimestamp(latest.timestamp)}</Text>
          </Card>
        ) : <Message title="No history yet" />}
        {adding ? (
          <Card>
            <Text style={styles.heading}>Add reading</Text>
            <Text style={styles.meta}>Record a new {detail.measurement.displayName.toLocaleLowerCase()} reading.</Text>
            <ReadingEditor
              busy={actionBusy}
              cancelLabel="Cancel"
              dateOnly={usesDateOnlyObservation(detail.measurement.aggregation)}
              draft={draft}
              onCancel={() => setAdding(false)}
              onChangeDraft={setDraft}
              onSubmit={() => { void saveNewReading(); }}
              submitLabel="Save reading"
            />
          </Card>
        ) : null}
        <Card>
          <Text style={styles.heading}>Reference range</Text>
          <Text style={styles.value}>{formatReferenceRange(detail.referenceRange.effective)}</Text>
          <Text style={styles.meta}>{referenceRangeSourceLabel(detail.referenceRange.source)}</Text>
        </Card>
        <Card>
          <Text style={styles.heading}>Trend</Text>
          <TrendChart
            busy={chartLoading}
            detail={detail}
            error={chartError}
            mode={chartMode}
            onModeChange={setChartMode}
            onRangeChange={setChartRange}
            range={chartRange}
            series={chartSeries}
          />
        </Card>
        <View style={styles.historyHeader}>
          <Text style={styles.heading}>History</Text>
          <Text style={styles.meta}>{hasEditableEntries ? "Select a reading to manage it." : "Synced readings are read-only."}</Text>
        </View>
        {pendingDeletion ? (
          <View accessibilityLiveRegion="polite" style={styles.undoBanner}>
            <View style={styles.flex}>
              <Text style={styles.undoTitle}>Reading removed</Text>
              <Text style={styles.meta}>Undo within a few seconds to keep this reading.</Text>
            </View>
            <Button secondary onPress={cancelDeletion}>Undo</Button>
          </View>
        ) : null}
        <View style={styles.historyList}>
          {visibleEntries.map((entry) => {
            const selected = selectedEntryId === entry.id;
            const editingEntry = editing?.id === entry.id;
            const canManage = !readOnly && entry.kind === "observation" && entry.canDelete;
            const reading = (
              <>
                <View style={styles.flex}>
                  <Text style={styles.value}>{entry.value} {entry.unit}</Text>
                  <Text style={styles.meta}>{formatTimestamp(entry.timestamp)}</Text>
                  <Text style={styles.meta}>{formatSource(entry)}</Text>
                  {entry.note ? <Text style={styles.note}>{entry.note}</Text> : null}
                </View>
                <View style={styles.rowEnd}>
                  <ReadingStatus entry={entry} />
                  {canManage ? <ChevronRight color={colors.muted} size={20} /> : null}
                </View>
              </>
            );
            return (
              <View key={`${entry.kind}-${entry.id}`} style={[styles.historyItem, selected && styles.historyItemSelected]}>
                {canManage ? (
                  <Pressable
                    accessibilityHint="Selects this reading to edit or delete it."
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    disabled={actionBusy || adding || Boolean(pendingDeletion)}
                    onPress={() => {
                      setSelectedEntryId(entry.id);
                      if (!editingEntry) setActionFeedback(undefined);
                    }}
                    style={({ pressed }) => [styles.historyRow, pressed && styles.historyRowPressed]}
                  >
                    {reading}
                  </Pressable>
                ) : <View style={styles.historyRow}>{reading}</View>}
                {selected && canManage && !editingEntry ? (
                  <View style={styles.recordActions}>
                    <Button disabled={actionBusy || adding || Boolean(pendingDeletion)} secondary onPress={() => beginEdit(entry)}>Edit reading</Button>
                    <Button danger disabled={actionBusy || adding || Boolean(pendingDeletion)} onPress={() => stageDeletion(entry)}>Delete reading</Button>
                  </View>
                ) : null}
                {editingEntry ? (
                  <ReadingEditor
                    busy={actionBusy}
                    cancelLabel="Keep editing later"
                    dateOnly={usesDateOnlyObservation(detail.measurement.aggregation)}
                    draft={draft}
                    onCancel={() => setEditing(undefined)}
                    onChangeDraft={setDraft}
                    onSubmit={() => { void saveEdit(); }}
                    submitLabel="Save changes"
                  />
                ) : null}
                {actionFeedback?.entryId === entry.id ? <Message detail={actionFeedback.detail} title={actionFeedback.title} tone={actionFeedback.tone} /> : null}
              </View>
            );
          })}
        </View>
        {actionFeedback && !actionFeedback.entryId ? <Message detail={actionFeedback.detail} title={actionFeedback.title} tone={actionFeedback.tone} /> : null}
        {error ? <Message title="Could not load more history" detail={error} tone="danger" /> : null}
        {detail.pagination.hasMore ? (
          <Button disabled={loadingMore} onPress={() => { void loadMore(); }}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function ReadingEditor({
  busy,
  cancelLabel,
  dateOnly,
  draft,
  onCancel,
  onChangeDraft,
  onSubmit,
  submitLabel
}: {
  busy: boolean;
  cancelLabel: string;
  dateOnly: boolean;
  draft: ReadingDraft;
  onCancel: () => void;
  onChangeDraft: Dispatch<SetStateAction<ReadingDraft>>;
  onSubmit: () => void;
  submitLabel: string;
}) {
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);

  useEffect(() => {
    if (dateOnly) setTimePickerOpen(false);
  }, [dateOnly]);

  function updateDate(value: Date) {
    onChangeDraft((current) => ({ ...current, observedAt: combineDateAndTime(value, current.observedAt) }));
  }

  function updateTime(value: Date) {
    onChangeDraft((current) => ({ ...current, observedAt: combineDateAndTime(current.observedAt, value) }));
  }

  return (
    <View style={styles.editor}>
      <View style={styles.dateTimeRow}>
        <Pressable
          accessibilityHint="Opens the observed date picker"
          accessibilityLabel={`Observed date: ${formatObservedDate(draft.observedAt)}`}
          accessibilityRole="button"
          disabled={busy}
          onPress={() => setDatePickerOpen(true)}
          style={({ pressed }) => [styles.dateField, pressed && styles.dateFieldPressed, busy && styles.dateFieldDisabled]}
        >
          <View style={styles.flex}>
            <Text style={styles.label}>Observed date</Text>
            <Text style={styles.dateValue}>{formatObservedDate(draft.observedAt)}</Text>
          </View>
          <CalendarDays color={colors.primary} size={21} />
        </Pressable>
        {!dateOnly ? (
          <Pressable
            accessibilityHint="Opens the observed time picker"
            accessibilityLabel={`Observed time: ${formatObservedTime(draft.observedAt)}`}
            accessibilityRole="button"
            disabled={busy}
            onPress={() => setTimePickerOpen(true)}
            style={({ pressed }) => [styles.dateField, pressed && styles.dateFieldPressed, busy && styles.dateFieldDisabled]}
          >
            <View style={styles.flex}>
              <Text style={styles.label}>Observed time</Text>
              <Text style={styles.dateValue}>{formatObservedTime(draft.observedAt)}</Text>
            </View>
            <Clock3 color={colors.primary} size={21} />
          </Pressable>
        ) : null}
      </View>
      {datePickerOpen ? (
        <View style={styles.pickerSurface}>
          <DateTimePicker
            mode="date"
            onChange={(_event, value) => {
              if (value) updateDate(value);
              if (Platform.OS !== "ios") setDatePickerOpen(false);
            }}
            value={draft.observedAt}
          />
          {Platform.OS === "ios" ? <Button secondary onPress={() => setDatePickerOpen(false)}>Done</Button> : null}
        </View>
      ) : null}
      {!dateOnly && timePickerOpen ? (
        <View style={styles.pickerSurface}>
          <DateTimePicker
            mode="time"
            onChange={(_event, value) => {
              if (value) updateTime(value);
              if (Platform.OS !== "ios") setTimePickerOpen(false);
            }}
            value={draft.observedAt}
          />
          {Platform.OS === "ios" ? <Button secondary onPress={() => setTimePickerOpen(false)}>Done</Button> : null}
        </View>
      ) : null}
      <Text style={styles.label}>Value</Text>
      <TextInput
        accessibilityLabel="Value"
        editable={!busy}
        keyboardType="decimal-pad"
        onChangeText={(value) => onChangeDraft((current) => ({ ...current, value }))}
        style={styles.input}
        value={draft.value}
      />
      <Text style={styles.label}>Unit</Text>
      <TextInput
        accessibilityLabel="Unit"
        editable={!busy}
        maxLength={40}
        onChangeText={(unit) => onChangeDraft((current) => ({ ...current, unit }))}
        style={styles.input}
        value={draft.unit}
      />
      <Text style={styles.label}>Note</Text>
      <TextInput
        accessibilityLabel="Note"
        editable={!busy}
        maxLength={1000}
        multiline
        onChangeText={(note) => onChangeDraft((current) => ({ ...current, note }))}
        style={styles.input}
        value={draft.note}
      />
      <View style={styles.recordActions}>
        <Button disabled={busy} onPress={onSubmit}>{busy ? "Saving…" : submitLabel}</Button>
        <Button disabled={busy} secondary onPress={onCancel}>{cancelLabel}</Button>
      </View>
    </View>
  );
}

function formatTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return "Date unavailable";
  if (isUtcMidnightTimestamp(value)) {
    return timestamp.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC"
    });
  }
  return timestamp.toLocaleString();
}

function formatShortDate(value: string): string {
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime())
    ? timestamp.toLocaleDateString(undefined, { day: "numeric", month: "short" })
    : "—";
}

function formatObservedDate(value: Date): string {
  return value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function formatObservedTime(value: Date): string {
  return value.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function combineDateAndTime(date: Date, time: Date): Date {
  const next = new Date(date);
  next.setHours(time.getHours(), time.getMinutes(), time.getSeconds(), time.getMilliseconds());
  return next;
}

function serializeObservedAt(value: Date, dateOnly: boolean): string {
  if (!dateOnly) return value.toISOString();
  const observedAt = calendarDateToUtcMidnight(localCalendarDate(value));
  if (!observedAt) throw new Error("Choose a valid date.");
  return observedAt;
}

function formatChartValue(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function formatReferenceRange(range: HealthDataDetail["referenceRange"]["effective"]): string {
  if (!range) return "Not set";
  if (range.low !== undefined && range.high !== undefined) {
    return `${formatChartValue(range.low)}–${formatChartValue(range.high)} ${range.unit}`;
  }
  if (range.high !== undefined) return `≤ ${formatChartValue(range.high)} ${range.unit}`;
  if (range.low !== undefined) return `≥ ${formatChartValue(range.low)} ${range.unit}`;
  return "Not set";
}

function referenceRangeSourceLabel(source: HealthDataDetail["referenceRange"]["source"]): string {
  return { personal: "Personal range", catalog: "Catalog range", none: "No reference range available" }[source];
}

function formatSource(entry: HealthDataDetailEntry): string {
  switch (entry.sourceKind) {
    case "health-connect": return "Synced from phone";
    case "manual-entry": return "Entered manually";
    case "blood-test-report": return "Imported from blood test report";
    case "body-composition-report": return "Imported from body composition report";
    case "blood-test-csv": return "Imported from blood test file";
    case "observation-csv": return "Imported from file";
    case "derived": return "Calculated from your records";
    default: return entry.sourceLabel ? "Imported record" : "Local record";
  }
}

function ReadingStatus({ entry }: { entry: HealthDataDetailEntry }) {
  if (!entry.referenceRange || !entry.status || entry.status === "unknown") return null;
  const statusStyles = {
    low: { container: styles.statusLow, text: styles.statusLowText },
    normal: { container: styles.statusNormal, text: styles.statusNormalText },
    high: { container: styles.statusHigh, text: styles.statusHighText }
  }[entry.status];
  return (
    <View style={[styles.status, statusStyles.container]}>
      <Text style={[styles.statusText, statusStyles.text]}>{entry.status}</Text>
    </View>
  );
}

const trendRanges: Array<{ value: HealthDataChartRange; label: string }> = [
  { value: "all", label: "All" },
  { value: "1y", label: "1Y" },
  { value: "3m", label: "3M" },
  { value: "1m", label: "1M" }
];

function TrendChart({
  busy,
  detail,
  error,
  mode,
  onModeChange,
  onRangeChange,
  range,
  series
}: {
  busy: boolean;
  detail: HealthDataDetail;
  error?: string;
  mode: HealthDataChartMode;
  onModeChange: (mode: HealthDataChartMode) => void;
  onRangeChange: (range: HealthDataChartRange) => void;
  range: HealthDataChartRange;
  series?: HealthDataChartSeries;
}) {
  const chartPoints = (series?.points ?? []).map((point) => ({ ...point, kind: "observation" as const }));
  const baseDomain = calculateChartDomain(chartPoints);
  const latestPoint = chartPoints.at(-1);
  const [selectedTimestamp, setSelectedTimestamp] = useState(latestPoint?.timestamp);

  useEffect(() => {
    setSelectedTimestamp(latestPoint?.timestamp);
  }, [detail.measurement.code, latestPoint?.timestamp]);

  const controls = (
    <>
      <View accessibilityLabel="Trend chart range" accessibilityRole="radiogroup" style={styles.chartControls}>
        {trendRanges.map((option) => (
          <ChartToggle key={option.value} label={option.label} onPress={() => onRangeChange(option.value)} selected={range === option.value} />
        ))}
      </View>
      {series?.aggregation !== "latest" ? (
        <View accessibilityLabel="Trend chart display" accessibilityRole="radiogroup" style={styles.chartControls}>
          <ChartToggle label="Adaptive" onPress={() => onModeChange("auto")} selected={mode === "auto"} />
          <ChartToggle label="Readings" onPress={() => onModeChange("raw")} selected={mode === "raw"} />
        </View>
      ) : null}
    </>
  );
  if (!baseDomain) {
    return <View style={styles.chart}>{controls}<Text style={styles.meta}>{busy ? "Loading trend…" : error ?? "No numeric trend points in this range."}</Text></View>;
  }
  const referenceRange = detail.referenceRange.effective;
  const chartReferenceRange = referenceRange &&
    chartPoints.every((point) => point.unit === referenceRange.unit)
    ? referenceRange
    : undefined;
  const referenceBounds = [chartReferenceRange?.low, chartReferenceRange?.high]
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  const domain = {
    ...baseDomain,
    yMin: Math.min(baseDomain.yMin, ...referenceBounds),
    yMax: Math.max(baseDomain.yMax, ...referenceBounds)
  };
  const width = 320;
  const height = 174;
  const chartLeft = 44;
  const chartRight = 308;
  const chartTop = 12;
  const chartBottom = 126;
  const xRange = domain.xMax - domain.xMin || 1;
  const yRange = domain.yMax - domain.yMin || 1;
  const points = chartPoints.map((point) => ({
    ...point,
    x: chartLeft + ((Date.parse(point.timestamp) - domain.xMin) / xRange) * (chartRight - chartLeft),
    y: chartBottom - ((point.value - domain.yMin) / yRange) * (chartBottom - chartTop)
  }));
  const selectedPoint = points.find((point) => point.timestamp === selectedTimestamp) ?? points.at(-1);
  const yTicks = [domain.yMax, domain.yMin + yRange / 2, domain.yMin];
  const path = points.map((point, index) =>
    `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  return (
    <View style={styles.chart}>
      {controls}
      {error ? <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text> : null}
      {selectedPoint ? (
        <View accessibilityLiveRegion="polite" style={styles.chartReading}>
          <Text style={styles.chartReadingValue}>{formatChartValue(selectedPoint.value)} {selectedPoint.unit}</Text>
          <Text style={styles.meta}>{formatTimestamp(selectedPoint.timestamp)}</Text>
        </View>
      ) : null}
      {chartReferenceRange ? (
        <View style={styles.chartLegend}>
          <View style={styles.referenceLine} />
          <Text style={styles.meta}>Reference range: {formatReferenceRange(chartReferenceRange)} · {referenceRangeSourceLabel(detail.referenceRange.source)}</Text>
        </View>
      ) : null}
      {points.length > 1 ? <Text style={styles.chartHint}>Tap a point to compare a reading.</Text> : null}
      <Svg accessibilityLabel={`${detail.measurement.displayName} trend with ${points.length} selectable points${chartReferenceRange ? ` and reference range ${formatReferenceRange(chartReferenceRange)}` : ""}`} height={height} width="100%" viewBox={`0 0 ${width} ${height}`}>
        {yTicks.map((tick) => {
          const y = chartBottom - ((tick - domain.yMin) / yRange) * (chartBottom - chartTop);
          return (
            <Line key={tick} x1={chartLeft} x2={chartRight} y1={y} y2={y} stroke={colors.border} strokeWidth={1} />
          );
        })}
        {referenceBounds.map((bound) => {
          const y = chartBottom - ((bound - domain.yMin) / yRange) * (chartBottom - chartTop);
          return (
            <Line
              key={`reference-${bound}`}
              x1={chartLeft}
              x2={chartRight}
              y1={y}
              y2={y}
              stroke={colors.success}
              strokeDasharray="5 4"
              strokeWidth={2}
            />
          );
        })}
        {yTicks.map((tick) => {
          const y = chartBottom - ((tick - domain.yMin) / yRange) * (chartBottom - chartTop);
          return <SvgText key={`label-${tick}`} fill={colors.muted} fontSize={11} textAnchor="end" x={chartLeft - 7} y={y + 4}>{formatChartValue(tick)}</SvgText>;
        })}
        <Path d={path} fill="none" stroke={colors.primary} strokeWidth={3} />
        {points.map((point) => (
          <Fragment key={`${point.timestamp}-${point.value}`}>
            <Circle
              accessibilityLabel={`${formatChartValue(point.value)} ${point.unit}, ${formatTimestamp(point.timestamp)}`}
              cx={point.x}
              cy={point.y}
              fill="transparent"
              onPress={() => setSelectedTimestamp(point.timestamp)}
              r={14}
            />
            <Circle
              cx={point.x}
              cy={point.y}
              fill={point.timestamp === selectedPoint?.timestamp ? colors.primaryStrong : colors.primary}
              pointerEvents="none"
              r={point.timestamp === selectedPoint?.timestamp ? 6 : 4}
            />
          </Fragment>
        ))}
        <SvgText fill={colors.muted} fontSize={11} textAnchor="start" x={chartLeft} y={154}>{formatShortDate(points[0].timestamp)}</SvgText>
        <SvgText fill={colors.muted} fontSize={11} textAnchor="end" x={chartRight} y={154}>{formatShortDate(points.at(-1)!.timestamp)}</SvgText>
      </Svg>
    </View>
  );
}

function ChartToggle({ label, onPress, selected }: { label: string; onPress: () => void; selected: boolean }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[styles.chartToggle, selected && styles.chartToggleSelected]}
    >
      <Text style={[styles.chartToggleText, selected && styles.chartToggleTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  titleRow: { alignItems: "flex-start", flexDirection: "row", gap: spacing.sm, justifyContent: "space-between" },
  title: { color: colors.text, fontSize: 24, fontWeight: "800", marginBottom: spacing.xs },
  label: { color: colors.muted, fontSize: 14, fontWeight: "700" },
  latest: { color: colors.text, fontSize: 28, fontWeight: "800" },
  heading: { color: colors.text, fontSize: 18, fontWeight: "800" },
  row: { flexDirection: "row", justifyContent: "space-between" },
  rowEnd: { alignItems: "center", flexDirection: "row", gap: spacing.xs },
  latestRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  recordActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  editor: { borderTopColor: colors.border, borderTopWidth: 1, gap: spacing.sm, paddingTop: spacing.md },
  input: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.text,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm
  },
  flex: { flex: 1, gap: spacing.xs },
  value: { color: colors.text, fontSize: 17, fontWeight: "700" },
  meta: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  note: { color: colors.text, fontSize: 14, lineHeight: 19, marginTop: spacing.xs },
  historyHeader: { gap: spacing.xs, marginTop: spacing.sm },
  historyList: { borderColor: colors.border, borderRadius: 0, borderTopWidth: 1 },
  historyItem: { borderBottomColor: colors.border, borderBottomWidth: 1, gap: spacing.sm, paddingVertical: spacing.md },
  historyItemSelected: { backgroundColor: colors.surfaceMuted, marginHorizontal: -spacing.sm, paddingHorizontal: spacing.sm },
  historyRow: { alignItems: "flex-start", flexDirection: "row", gap: spacing.sm, minHeight: 48 },
  historyRowPressed: { opacity: 0.76 },
  undoBanner: { alignItems: "center", backgroundColor: colors.infoMuted, borderRadius: 8, flexDirection: "row", gap: spacing.sm, padding: spacing.sm },
  undoTitle: { color: colors.info, fontSize: 15, fontWeight: "800" },
  dateTimeRow: { gap: spacing.sm },
  dateField: { alignItems: "center", backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  dateFieldPressed: { backgroundColor: colors.primaryMuted },
  dateFieldDisabled: { opacity: 0.5 },
  dateValue: { color: colors.text, fontSize: 15, fontWeight: "700" },
  pickerSurface: { backgroundColor: colors.surfaceMuted, borderRadius: 8, gap: spacing.sm, padding: spacing.sm },
  chart: { gap: spacing.xs },
  chartControls: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chartToggle: { borderColor: colors.border, borderRadius: 999, borderWidth: 1, minHeight: 40, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chartToggleSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chartToggleText: { color: colors.text, fontSize: 14, fontWeight: "700" },
  chartToggleTextSelected: { color: colors.onAccent },
  errorText: { color: colors.danger, fontSize: 14, lineHeight: 19 },
  chartReading: { alignItems: "baseline", flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chartReadingValue: { color: colors.text, fontSize: 17, fontWeight: "800" },
  chartLegend: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  referenceLine: { borderColor: colors.success, borderStyle: "dashed", borderTopWidth: 2, width: 28 },
  chartHint: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  status: { alignSelf: "flex-start", borderRadius: 999, marginLeft: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  statusText: { fontSize: 14, fontWeight: "700", textTransform: "capitalize" },
  statusLow: { backgroundColor: colors.warningMuted },
  statusLowText: { color: colors.warning },
  statusNormal: { backgroundColor: colors.successMuted },
  statusNormalText: { color: colors.success },
  statusHigh: { backgroundColor: colors.dangerMuted },
  statusHighText: { color: colors.danger }
});
