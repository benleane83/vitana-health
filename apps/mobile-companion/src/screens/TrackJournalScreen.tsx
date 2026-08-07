import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { BedDouble, ClipboardCheck, Footprints } from "lucide-react-native";
import type { JournalPage, JournalTimelineItem } from "@vitana/shared";
import { useMobileApi } from "../MobileApiProvider";
import { Button, Loading, Message, Screen } from "../ui/components";
import { colors, radii, spacing, type } from "../ui/theme";

const journalDayLimit = 14;

export function TrackJournalScreen() {
  const { journal, standaloneMode } = useMobileApi();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [data, setData] = useState<JournalPage>();
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string>();
  const [olderError, setOlderError] = useState<string>();
  const [retryToken, setRetryToken] = useState(0);
  const olderRequest = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    olderRequest.current?.abort();
    setLoading(true);
    setError(undefined);
    void journal({ timezone, dayLimit: journalDayLimit }, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) setData(page);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("We couldn't load your Journal. Please try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      olderRequest.current?.abort();
    };
  }, [journal, retryToken, timezone]);

  async function loadOlderDays() {
    if (!data?.nextBeforeDate || loadingOlder) return;
    olderRequest.current?.abort();
    const controller = new AbortController();
    olderRequest.current = controller;
    setLoadingOlder(true);
    setOlderError(undefined);
    try {
      const older = await journal({ timezone, dayLimit: journalDayLimit, beforeDate: data.nextBeforeDate }, controller.signal);
      if (!controller.signal.aborted) setData({ ...older, days: [...data.days, ...older.days] });
    } catch {
      if (!controller.signal.aborted) setOlderError("Couldn't load older days. Check your connection and try again.");
    } finally {
      if (olderRequest.current === controller) setLoadingOlder(false);
    }
  }

  if (loading && !data) return <Screen><Loading label="Loading Journal..." /></Screen>;
  if (error && !data) {
    return <Screen><View style={styles.messageStack}><Message title="Journal unavailable" detail={error} tone="warning" /><Button onPress={() => setRetryToken((value) => value + 1)}>Retry</Button></View></Screen>;
  }

  const days = data?.days ?? [];
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.intro}>
          <Text style={styles.title}>Your days, in context</Text>
          <Text style={styles.subtitle}>Your activity, sleep, and health events, day by day.</Text>
        </View>
        {days.length === 0 ? (
          <Message
            title="Nothing recorded yet"
            detail={standaloneMode
              ? "Activity, sleep, and health events will appear here when local support is available."
              : "Activity, sleep, and health events appear here after you add or sync them."}
          />
        ) : null}
        {days.map((day) => (
          <View key={day.date} style={styles.day}>
            <View style={styles.dayHeader}>
              <Text style={styles.dayTitle}>{formatDay(day.date, timezone)}</Text>
              <View style={styles.summary} accessibilityLabel="Daily summary">
                {day.summary.steps ? <Text style={styles.summaryText}>{formatNumber(day.summary.steps.value)} steps</Text> : null}
                {day.summary.sleepDurationMinutes ? <Text style={styles.summaryText}>{formatDuration(day.summary.sleepDurationMinutes)} sleep</Text> : null}
              </View>
            </View>
            <View style={styles.timeline}>
              {day.items.map((item) => <JournalItem key={`${item.kind}:${item.id}`} item={item} timezone={timezone} />)}
            </View>
            {day.omittedItemCount > 0 ? <Text style={styles.omitted}>{day.omittedItemCount} more records are hidden to keep this day easy to scan.</Text> : null}
          </View>
        ))}
        {data?.nextBeforeDate ? (
          <View style={styles.loadMore}>
            {olderError ? <Message title="Older days unavailable" detail={olderError} tone="warning" /> : null}
            <Button secondary disabled={loadingOlder} onPress={() => void loadOlderDays()}>
              {loadingOlder ? "Loading older days..." : olderError ? "Try again" : "Load older days"}
            </Button>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function JournalItem({ item, timezone }: { item: JournalTimelineItem; timezone: string }) {
  const Icon = item.kind === "activity" ? Footprints : item.kind === "sleep" ? BedDouble : ClipboardCheck;
  const detail = item.kind === "activity"
    ? [
        item.durationMinutes === undefined ? undefined : formatDuration(item.durationMinutes),
        item.distanceMeters === undefined ? undefined : `${formatNumber(item.distanceMeters / 1000)} km`,
        item.energyKcal === undefined ? undefined : `${formatNumber(item.energyKcal)} kcal`
      ].filter(Boolean).join(" | ")
    : item.kind === "sleep"
      ? `${formatDuration(item.durationMinutes)} | ${formatTime(item.startAt, timezone)} to ${formatTime(item.endAt, timezone)}`
      : item.detail;
  const title = item.kind === "sleep" ? "Sleep" : item.title;
  const fallback = item.kind === "activity" ? item.activityType : item.kind === "health-event" ? item.eventKind : "Sleep session";
  return (
    <View style={styles.item}>
      <Text style={styles.time}>{formatTime(item.occurredAt, timezone)}</Text>
      <View style={[styles.itemIcon, item.kind === "sleep" && styles.sleepIcon, item.kind === "health-event" && styles.eventIcon]}>
        <Icon color={colors.primary} size={18} strokeWidth={2.1} />
      </View>
      <View style={styles.itemText}>
        <Text style={styles.itemTitle}>{title}</Text>
        <Text style={styles.itemDetail}>{detail || fallback}</Text>
      </View>
    </View>
  );
}

function formatDay(date: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: timezone, weekday: "long", month: "short", day: "numeric" })
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
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingBottom: spacing.xl },
  intro: { gap: spacing.xs },
  title: { color: colors.textStrong, fontSize: type.heading, fontWeight: "800" },
  subtitle: { color: colors.muted, fontSize: type.body, lineHeight: 22 },
  messageStack: { gap: spacing.md },
  day: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, overflow: "hidden" },
  dayHeader: { gap: spacing.sm, padding: spacing.md },
  dayTitle: { color: colors.textStrong, fontSize: type.title, fontWeight: "800" },
  summary: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  summaryText: { backgroundColor: colors.surfaceMuted, borderRadius: radii.pill, color: colors.muted, fontSize: 12, fontWeight: "700", paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  timeline: { borderTopColor: colors.border, borderTopWidth: 1 },
  item: { alignItems: "flex-start", flexDirection: "row", gap: spacing.sm, minHeight: 76, padding: spacing.md },
  time: { color: colors.muted, fontSize: 12, paddingTop: 3, width: 62 },
  itemIcon: { alignItems: "center", backgroundColor: colors.primaryMuted, borderRadius: radii.sm, height: 34, justifyContent: "center", width: 34 },
  sleepIcon: { backgroundColor: colors.infoMuted },
  eventIcon: { backgroundColor: colors.blushMuted },
  itemText: { flex: 1, gap: 2, minWidth: 0 },
  itemTitle: { color: colors.textStrong, fontSize: type.body, fontWeight: "800" },
  itemDetail: { color: colors.muted, fontSize: type.label, lineHeight: 19 },
  omitted: { borderTopColor: colors.border, borderTopWidth: 1, color: colors.muted, fontSize: type.label, lineHeight: 19, padding: spacing.md },
  loadMore: { gap: spacing.sm }
});