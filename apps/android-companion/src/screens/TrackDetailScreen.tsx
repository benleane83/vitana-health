import { Fragment, useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";
import {
  calculateChartDomain,
  isUtcMidnightTimestamp,
  mergeHealthDataDetail,
  type HealthDataDetail,
  type HealthDataDetailEntry
} from "@local-fitness-advisor/shared";
import { useMobileApi } from "../MobileApiProvider";
import type { RootStackParamList } from "../navigationTypes";
import { Button, Card, Loading, Message, Screen } from "../ui/components";
import { colors, spacing } from "../ui/theme";

type Props = NativeStackScreenProps<RootStackParamList, "TrackDetail">;

export function TrackDetailScreen({ route }: Props) {
  const {
    deleteObservation,
    demoMode,
    healthDataDetail,
    refreshTrack,
    updateObservation
  } = useMobileApi();
  const [detail, setDetail] = useState<HealthDataDetail>();
  const [error, setError] = useState<string>();
  const [actionMessage, setActionMessage] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [editing, setEditing] = useState<HealthDataDetailEntry>();
  const [draft, setDraft] = useState({ observedAt: "", value: "", unit: "", note: "" });

  useEffect(() => {
    let current = true;
    setDetail(undefined);
    setLoading(true);
    setError(undefined);
    void healthDataDetail(route.params.measurementCode).then((value) => {
      if (current) setDetail(value);
    }).catch((caught: unknown) => {
      if (current) setError(caught instanceof Error ? caught.message : "Unable to load metric.");
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [healthDataDetail, route.params.measurementCode]);

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
      setError(caught instanceof Error ? caught.message : "Unable to load more history.");
    } finally {
      setLoadingMore(false);
    }
  }

  function beginEdit(entry: HealthDataDetailEntry) {
      setEditing(entry);
      setDraft({
        observedAt: entry.timestamp,
        value: String(entry.value),
        unit: entry.unit,
        note: entry.note ?? ""
      });
      setActionMessage(undefined);
    }

  async function refreshAfterMutation(message: string) {
      const next = await healthDataDetail(route.params.measurementCode);
      setDetail(next);
      setActionMessage(message);
      await refreshTrack();
    }

  async function saveEdit() {
      if (!editing) return;
      const value = Number(draft.value);
      if (!Number.isFinite(value) || !draft.unit.trim() || !Number.isFinite(Date.parse(draft.observedAt))) {
        setActionMessage("Enter a valid date, numeric value, and unit.");
        return;
      }
      setActionBusy(true);
      setActionMessage(undefined);
      try {
        await updateObservation(editing.id, {
          measurementCode: editing.measurementCode,
          observedAt: new Date(draft.observedAt).toISOString(),
          value,
          unit: draft.unit.trim(),
          note: draft.note.trim() || undefined
        });
        setEditing(undefined);
        await refreshAfterMutation("Observation updated.");
      } catch (caught) {
        setActionMessage(caught instanceof Error ? caught.message : "Unable to update observation.");
      } finally {
        setActionBusy(false);
      }
    }

  function confirmDelete(entry: HealthDataDetailEntry) {
      Alert.alert(
        "Delete observation?",
        `Delete the ${entry.value} ${entry.unit} reading from ${formatTimestamp(entry.timestamp)}?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => { void removeEntry(entry); }
          }
        ]
      );
    }

  async function removeEntry(entry: HealthDataDetailEntry) {
      setActionBusy(true);
      setActionMessage(undefined);
      try {
        await deleteObservation(entry.id);
        if (editing?.id === entry.id) setEditing(undefined);
        await refreshAfterMutation("Observation deleted.");
      } catch (caught) {
        setActionMessage(caught instanceof Error ? caught.message : "Unable to delete observation.");
      } finally {
        setActionBusy(false);
    }
  }

  if (loading) return <Screen><Loading label="Loading metric…" /></Screen>;
  if (!detail) return <Screen><Message title="Metric unavailable" detail={error} /></Screen>;
  const latest = detail.entries[0];

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View>
          <Text style={styles.title}>{detail.measurement.displayName}</Text>
          {detail.measurement.description ? <Text style={styles.meta}>{detail.measurement.description}</Text> : null}
        </View>
        {latest ? (
          <Card>
            <Text style={styles.label}>Latest</Text>
            <Text adjustsFontSizeToFit numberOfLines={1} style={styles.latest}>{latest.value} {latest.unit}</Text>
            <Text style={styles.meta}>{formatTimestamp(latest.timestamp)}</Text>
          </Card>
        ) : <Message title="No history yet" />}
        <Card>
          <Text style={styles.heading}>Reference range</Text>
          <Text style={styles.value}>{formatReferenceRange(detail.referenceRange.effective)}</Text>
          <Text style={styles.meta}>{referenceRangeSourceLabel(detail.referenceRange.source)}</Text>
        </Card>
        <Card>
          <Text style={styles.heading}>Trend</Text>
          <TrendChart detail={detail} />
        </Card>
        <Text style={styles.heading}>History</Text>
        {detail.entries.map((entry) => (
          <Card key={`${entry.kind}-${entry.id}`}>
            <View style={styles.row}>
              <View style={styles.flex}>
                <Text style={styles.value}>{entry.value} {entry.unit}</Text>
                <Text style={styles.meta}>{formatTimestamp(entry.timestamp)}</Text>
                <Text style={styles.meta}>{formatSource(entry)}</Text>
              </View>
              <ReadingStatus entry={entry} />
            </View>
            {entry.note ? <Text style={styles.meta}>{entry.note}</Text> : null}
            {entry.kind === "observation" && entry.canDelete && !demoMode ? (
               <View style={styles.actions}>
                 <Button disabled={actionBusy} secondary onPress={() => beginEdit(entry)}>Edit</Button>
                 <Button disabled={actionBusy} secondary onPress={() => confirmDelete(entry)}>Delete</Button>
               </View>
            ) : null}
            {editing?.id === entry.id ? (
               <View style={styles.editor}>
                 <Text style={styles.label}>Date and time</Text>
                 <TextInput
                   accessibilityLabel="Date and time"
                   editable={!actionBusy}
                   onChangeText={(observedAt) => setDraft((current) => ({ ...current, observedAt }))}
                   style={styles.input}
                   value={draft.observedAt}
                 />
                 <Text style={styles.label}>Value</Text>
                 <TextInput
                   accessibilityLabel="Value"
                   editable={!actionBusy}
                   keyboardType="decimal-pad"
                   onChangeText={(value) => setDraft((current) => ({ ...current, value }))}
                   style={styles.input}
                   value={draft.value}
                 />
                 <Text style={styles.label}>Unit</Text>
                 <TextInput
                   accessibilityLabel="Unit"
                   editable={!actionBusy}
                   maxLength={40}
                   onChangeText={(unit) => setDraft((current) => ({ ...current, unit }))}
                   style={styles.input}
                   value={draft.unit}
                 />
                 <Text style={styles.label}>Note</Text>
                 <TextInput
                   accessibilityLabel="Note"
                   editable={!actionBusy}
                   maxLength={1000}
                   multiline
                   onChangeText={(note) => setDraft((current) => ({ ...current, note }))}
                   style={styles.input}
                   value={draft.note}
                 />
                 <View style={styles.actions}>
                   <Button disabled={actionBusy} onPress={() => { void saveEdit(); }}>
                     {actionBusy ? "Saving…" : "Save changes"}
                   </Button>
                   <Button disabled={actionBusy} secondary onPress={() => setEditing(undefined)}>Cancel</Button>
                 </View>
               </View>
            ) : null}
          </Card>
        ))}
        {actionMessage ? <Message title="Measurement" detail={actionMessage} /> : null}
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

function TrendChart({ detail }: { detail: HealthDataDetail }) {
  const baseDomain = calculateChartDomain(detail.chartPoints);
  const latestPoint = detail.chartPoints.at(-1);
  const [selectedTimestamp, setSelectedTimestamp] = useState(latestPoint?.timestamp);

  useEffect(() => {
    setSelectedTimestamp(latestPoint?.timestamp);
  }, [detail.measurement.code, latestPoint?.timestamp]);

  if (!baseDomain) return <Text style={styles.meta}>No numeric trend points.</Text>;
  const referenceRange = detail.referenceRange.effective;
  const chartReferenceRange = referenceRange &&
    detail.chartPoints.every((point) => point.unit === referenceRange.unit)
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
  const points = detail.chartPoints.map((point) => ({
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
      {selectedPoint ? (
        <View accessibilityLiveRegion="polite" style={styles.chartReading}>
          <Text style={styles.chartReadingValue}>{formatChartValue(selectedPoint.value)} {selectedPoint.unit}</Text>
          <Text style={styles.meta}>{formatTimestamp(selectedPoint.timestamp)}</Text>
        </View>
      ) : null}
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

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  title: { color: colors.text, fontSize: 24, fontWeight: "800", marginBottom: spacing.xs },
  label: { color: colors.muted, fontSize: 14, fontWeight: "700" },
  latest: { color: colors.text, fontSize: 28, fontWeight: "800" },
  heading: { color: colors.text, fontSize: 18, fontWeight: "800" },
  row: { flexDirection: "row", justifyContent: "space-between" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
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
  chart: { gap: spacing.xs },
  chartReading: { alignItems: "baseline", flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chartReadingValue: { color: colors.text, fontSize: 17, fontWeight: "800" },
  status: { alignSelf: "flex-start", borderRadius: 999, marginLeft: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  statusText: { fontSize: 14, fontWeight: "700", textTransform: "capitalize" },
  statusLow: { backgroundColor: colors.warningMuted },
  statusLowText: { color: colors.warning },
  statusNormal: { backgroundColor: colors.successMuted },
  statusNormalText: { color: colors.success },
  statusHigh: { backgroundColor: colors.dangerMuted },
  statusHighText: { color: colors.danger }
});
