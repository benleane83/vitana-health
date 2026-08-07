import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Picker } from "@react-native-picker/picker";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { healthEventKindLabels, type CalendarMonthData, type HealthEvent } from "@vitana/shared";
import { useMobileApi } from "../MobileApiProvider";
import { Button, Message, Screen } from "../ui/components";
import { colors, radii, spacing, type } from "../ui/theme";
import { buildMonthCells, heatBuckets, localeWeekStart, localDayRange } from "./calendarModel";

export function TrackCalendarScreen() {
  const { bootstrap, calendarMonth, listHealthEvents, summary } = useMobileApi();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const today = localDate(new Date(), timezone);
  const recorded = useMemo(() => {
    const rows = summary?.categories.flatMap((category) => category.rows) ?? [];
    return [...rows].sort((left, right) => {
      if (left.code === "steps") return -1;
      if (right.code === "steps") return 1;
      return (right.lastMeasuredAt ?? "").localeCompare(left.lastMeasuredAt ?? "");
    });
  }, [summary]);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selectedCode, setSelectedCode] = useState("");
  const [selectedDate, setSelectedDate] = useState(today);
  const [data, setData] = useState<CalendarMonthData>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [retryToken, setRetryToken] = useState(0);
  const [eventDetails, setEventDetails] = useState<HealthEvent[]>([]);
  const [eventLoading, setEventLoading] = useState(false);
  const [eventError, setEventError] = useState<string>();

  useEffect(() => {
    if (!selectedCode && recorded[0]) setSelectedCode(recorded[0].code);
  }, [recorded, selectedCode]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    void calendarMonth({ month, timezone, measurementCodes: [selectedCode || "activity_sessions"] }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
        setSelectedDate((current) => current.startsWith(month) ? current : firstRecordedDate(result) ?? `${month}-01`);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("We couldn't load this month. Please try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [calendarMonth, month, retryToken, selectedCode, timezone]);

  useEffect(() => {
    const summary = data?.events.find((entry) => entry.date === selectedDate);
    if (!summary?.count) {
      setEventDetails([]);
      setEventError(undefined);
      setEventLoading(false);
      return;
    }
    let active = true;
    const { start, end } = localDayRange(selectedDate, timezone);
    setEventDetails([]);
    setEventError(undefined);
    setEventLoading(true);
    void listHealthEvents({ status: "completed", occurredFrom: start, occurredTo: end, limit: 100 })
      .then((result) => {
        if (active) setEventDetails(result.items);
      })
      .catch(() => {
        if (active) setEventError("We couldn't load health event details.");
      })
      .finally(() => {
        if (active) setEventLoading(false);
      });
    return () => { active = false; };
  }, [data, listHealthEvents, selectedDate, timezone]);

  const measurement = bootstrap?.measurementTypes.find((entry) => entry.code === selectedCode);
  const points = data?.measurements.filter((point) => point.measurementCode === selectedCode) ?? [];
  const pointsByDate = new Map(points.map((point) => [point.date, point]));
  const eventsByDate = new Map(data?.events.map((event) => [event.date, event]) ?? []);
  const buckets = heatBuckets(points);
  const cells = buildMonthCells(month);
  const weekStart = localeWeekStart();
  const weekdays = Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(undefined, { weekday: "narrow", timeZone: "UTC" })
    .format(new Date(Date.UTC(2026, 7, 2 + ((weekStart + index) % 7)))));
  const selectedPoint = pointsByDate.get(selectedDate);
  const selectedEvents = eventsByDate.get(selectedDate);

  function moveMonth(offset: number) {
    const [year, monthNumber] = month.split("-").map(Number);
    const next = new Date(Date.UTC(year, monthNumber - 1 + offset, 1)).toISOString().slice(0, 7);
    setMonth(next);
    setSelectedDate(`${next}-01`);
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>Compare a measurement with health events across the month.</Text>
        {recorded.length ? (
          <View style={styles.pickerField}>
            <Text style={styles.fieldLabel}>Measurement</Text>
            <Picker
              accessibilityLabel="Calendar measurement"
              selectedValue={selectedCode}
              style={styles.picker}
              onValueChange={(value) => setSelectedCode(String(value))}
            >
              {recorded.map((row) => <Picker.Item key={row.code} label={row.displayName} value={row.code} />)}
            </Picker>
          </View>
        ) : null}
        <View style={styles.monthHeader}>
          <Pressable accessibilityLabel="Previous month" accessibilityRole="button" hitSlop={8} onPress={() => moveMonth(-1)} style={styles.iconButton}>
            <ChevronLeft color={colors.primary} size={22} />
          </Pressable>
          <Text accessibilityLiveRegion="polite" style={styles.monthTitle}>{formatMonth(month)}</Text>
          <Pressable accessibilityLabel="Next month" accessibilityRole="button" hitSlop={8} onPress={() => moveMonth(1)} style={styles.iconButton}>
            <ChevronRight color={colors.primary} size={22} />
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => { setMonth(today.slice(0, 7)); setSelectedDate(today); }} style={styles.todayButton}>
            <Text style={styles.todayText}>Today</Text>
          </Pressable>
        </View>
        {error ? <View style={styles.errorStack}><Message title="Calendar unavailable" detail={error} tone="warning" /><Button secondary onPress={() => setRetryToken((value) => value + 1)}>Retry</Button></View> : null}
        <View accessibilityLabel={`${formatMonth(month)} calendar`} style={[styles.calendar, loading && styles.loading]}>
          <View style={styles.weekRow}>
            {weekdays.map((weekday, index) => <Text key={`${weekday}-${index}`} style={styles.weekday}>{weekday}</Text>)}
          </View>
          {Array.from({ length: cells.length / 7 }, (_, week) => (
            <View key={week} style={styles.weekRow}>
              {cells.slice(week * 7, week * 7 + 7).map((cell) => {
                const point = pointsByDate.get(cell.date);
                const event = eventsByDate.get(cell.date);
                const selected = selectedDate === cell.date;
                return cell.inMonth ? (
                  <Pressable
                    accessibilityLabel={dayAccessibilityLabel(cell.date, measurement?.display, point?.value, point?.unit, event?.count)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    key={cell.date}
                    onPress={() => setSelectedDate(cell.date)}
                    style={[styles.day, heatStyle(buckets.get(cell.date)), selected && styles.daySelected, cell.date === today && styles.today]}
                  >
                    <Text style={[styles.dayNumber, selected && styles.selectedText]}>{cell.day}</Text>
                    <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.dayValue, selected && styles.selectedText]}>{point ? formatValue(point.value) : "-"}</Text>
                    {event ? <View accessibilityElementsHidden style={[styles.eventDot, selected && styles.eventDotSelected]} /> : <View style={styles.eventPlaceholder} />}
                  </Pressable>
                ) : <View key={cell.date} style={styles.daySpacer} />;
              })}
            </View>
          ))}
          {loading ? <View style={styles.loadingOverlay}><ActivityIndicator color={colors.primary} /></View> : null}
        </View>
        <View style={styles.inspector}>
          <Text style={styles.inspectorDate}>{formatFullDate(selectedDate)}</Text>
          {selectedPoint ? (
            <View style={styles.readingRow}>
              <View style={styles.readingCopy}>
                <Text style={styles.readingLabel}>{measurement?.display ?? selectedPoint.measurementCode}</Text>
                <Text style={styles.readingMeta}>{selectedPoint.aggregation} · {selectedPoint.count} {selectedPoint.count === 1 ? "reading" : "readings"}</Text>
              </View>
              <Text style={styles.readingValue}>{formatValue(selectedPoint.value)} <Text style={styles.readingUnit}>{selectedPoint.unit}</Text></Text>
            </View>
          ) : <Text style={styles.emptyText}>No {measurement?.display.toLowerCase() ?? "measurement"} recorded.</Text>}
          {selectedEvents ? (
            <View style={styles.eventSection}>
              <Text style={styles.eventSummary}>{selectedEvents.count} health {selectedEvents.count === 1 ? "event" : "events"}</Text>
              {eventLoading ? <ActivityIndicator color={colors.primary} size="small" /> : null}
              {eventError ? <Text style={styles.eventError}>{eventError}</Text> : null}
              {!eventLoading && !eventError ? eventDetails.map((event) => (
                <View key={event.id} style={styles.eventDetail}>
                  <Text style={styles.eventKind}>{healthEventKindLabels[event.kind]}</Text>
                  {event.provider ? <Text style={styles.eventMeta}>Provider: {event.provider}</Text> : null}
                  {event.notes ? <Text style={styles.eventNotes}>{event.notes}</Text> : null}
                </View>
              )) : null}
            </View>
          ) : <Text style={styles.emptyText}>No health events.</Text>}
        </View>
      </ScrollView>
    </Screen>
  );
}

function heatStyle(level = 0) {
  return [undefined, styles.heat1, styles.heat2, styles.heat3, styles.heat4, styles.heat5][level];
}

function firstRecordedDate(data: CalendarMonthData): string | undefined {
  return [...data.measurements.map((point) => point.date), ...data.events.map((event) => event.date)].sort()[0];
}

function localDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (value: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === value)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function formatMonth(month: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
}

function formatFullDate(date: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

function formatValue(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}

function dayAccessibilityLabel(date: string, name?: string, value?: number, unit?: string, eventCount = 0): string {
  const parts = [formatFullDate(date), name ? `${name}: ${value === undefined ? "no reading" : `${formatValue(value)} ${unit}`}` : "No selected measurement"];
  parts.push(eventCount === 1 ? "1 health event" : `${eventCount} health events`);
  return parts.join(". ");
}

const styles = StyleSheet.create({
  content: { alignSelf: "center", gap: spacing.md, maxWidth: 680, paddingBottom: spacing.xl, width: "100%" },
  subtitle: { color: colors.muted, fontSize: type.body, lineHeight: 22 },
  pickerField: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, overflow: "hidden" },
  fieldLabel: { color: colors.muted, fontSize: 12, fontWeight: "700", paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  picker: { color: colors.text, minHeight: 48 },
  monthHeader: { alignItems: "center", flexDirection: "row", gap: spacing.xs },
  iconButton: { alignItems: "center", borderRadius: radii.sm, height: 44, justifyContent: "center", width: 44 },
  monthTitle: { color: colors.textStrong, flex: 1, fontSize: type.title, fontWeight: "800", textAlign: "center" },
  todayButton: { justifyContent: "center", minHeight: 44, paddingHorizontal: spacing.sm },
  todayText: { color: colors.primary, fontSize: type.label, fontWeight: "800" },
  errorStack: { gap: spacing.sm },
  calendar: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, gap: spacing.xs, padding: spacing.sm, position: "relative" },
  loading: { minHeight: 300 },
  weekRow: { flexDirection: "row", gap: spacing.xs },
  weekday: { color: colors.muted, flex: 1, fontSize: 12, fontWeight: "800", textAlign: "center" },
  day: { alignItems: "center", backgroundColor: colors.surfaceMuted, borderColor: "transparent", borderRadius: radii.sm, borderWidth: 2, flex: 1, height: 54, justifyContent: "space-between", minWidth: 0, paddingVertical: 5 },
  daySpacer: { flex: 1, height: 54 },
  daySelected: { backgroundColor: colors.primary, borderColor: colors.primaryStrong },
  today: { borderColor: colors.primary },
  dayNumber: { color: colors.text, fontSize: 12, fontWeight: "800" },
  dayValue: { color: colors.text, fontSize: 10, maxWidth: "100%" },
  selectedText: { color: colors.onAccent },
  eventDot: { backgroundColor: colors.blush, borderRadius: radii.pill, height: 5, width: 5 },
  eventDotSelected: { backgroundColor: colors.onAccent },
  eventPlaceholder: { height: 5 },
  heat1: { backgroundColor: colors.surfaceMuted },
  heat2: { backgroundColor: colors.lavenderMuted },
  heat3: { backgroundColor: colors.primaryMuted },
  heat4: { backgroundColor: colors.primaryMuted },
  heat5: { backgroundColor: colors.primaryMuted },
  loadingOverlay: { alignItems: "center", backgroundColor: "rgba(253,253,255,0.78)", bottom: 0, justifyContent: "center", left: 0, position: "absolute", right: 0, top: 0 },
  inspector: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, gap: spacing.md, padding: spacing.md },
  inspectorDate: { color: colors.textStrong, fontSize: type.title, fontWeight: "800" },
  readingRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm, justifyContent: "space-between" },
  readingCopy: { flex: 1, gap: 2, minWidth: 0 },
  readingLabel: { color: colors.text, fontSize: type.body, fontWeight: "700" },
  readingMeta: { color: colors.muted, fontSize: 12 },
  readingValue: { color: colors.textStrong, fontSize: type.title, fontWeight: "800" },
  readingUnit: { color: colors.muted, fontSize: type.label, fontWeight: "500" },
  eventSummary: { backgroundColor: colors.blushMuted, borderRadius: radii.sm, color: colors.blush, fontSize: type.label, fontWeight: "700", padding: spacing.sm },
  eventSection: { gap: spacing.sm },
  eventDetail: { borderTopColor: colors.border, borderTopWidth: 1, gap: 3, paddingTop: spacing.sm },
  eventKind: { color: colors.textStrong, fontSize: type.label, fontWeight: "800" },
  eventMeta: { color: colors.muted, fontSize: 12 },
  eventNotes: { color: colors.text, fontSize: type.label, lineHeight: 19 },
  eventError: { color: colors.warning, fontSize: type.label, lineHeight: 19 },
  emptyText: { color: colors.muted, fontSize: type.label, lineHeight: 19 }
});