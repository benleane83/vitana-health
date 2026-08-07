import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { BodyTrendPoint, BodyTrendTimeline, HealthDataChartRange } from "@vitana/shared";
import { useMobileApi } from "../MobileApiProvider";
import { Button, Loading, Message, Screen } from "../ui/components";
import { colors, radii, spacing, type } from "../ui/theme";

const ranges: Array<{ value: HealthDataChartRange; label: string }> = [
  { value: "1m", label: "1M" },
  { value: "3m", label: "3M" },
  { value: "1y", label: "1Y" },
  { value: "all", label: "All" }
];

const chartHeight = 150;

export function TrackBodyTrendScreen() {
  const { bodyTrendTimeline } = useMobileApi();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [range, setRange] = useState<HealthDataChartRange>("3m");
  const [timeline, setTimeline] = useState<BodyTrendTimeline>();
  const [selectedSessionId, setSelectedSessionId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    void bodyTrendTimeline({ range, timezone }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setTimeline(result);
        setSelectedSessionId((current) => result.points.some((point) => point.sessionId === current)
          ? current
          : result.points.at(-1)?.sessionId);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("We couldn't load body composition history. Please try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [bodyTrendTimeline, range, retryToken, timezone]);

  const selected = timeline?.points.find((point) => point.sessionId === selectedSessionId) ?? timeline?.points.at(-1);
  const domain = useMemo(() => Math.max(1, ...(timeline?.points.map((point) => Math.max(
    componentTotal(point), point.components.weight ?? 0
  )) ?? [1])) * 1.08, [timeline]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.intro}>
          <Text style={styles.title}>Body composition over time</Text>
          <Text style={styles.subtitle}>See how your body composition changes over time.</Text>
        </View>
        <View accessibilityRole="tablist" style={styles.rangeControl}>
          {ranges.map((option) => {
            const active = range === option.value;
            return (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                key={option.value}
                onPress={() => setRange(option.value)}
                style={[styles.rangeOption, active && styles.rangeOptionActive]}
              >
                <Text style={[styles.rangeText, active && styles.rangeTextActive]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
        {error ? <View style={styles.errorStack}><Message title="Body Trend unavailable" detail={error} tone="warning" /><Button secondary onPress={() => setRetryToken((value) => value + 1)}>Retry</Button></View> : null}
        {loading && !timeline ? <Loading label="Loading Body Trend…" /> : null}
        {!loading && !error && timeline?.points.length === 0 ? (
          <Message title="No complete body-composition readings" detail="Body Trend needs muscle, fat, and bone mass recorded together. Weight is optional." />
        ) : null}
        {timeline?.points.length ? (
          <View style={styles.chartCard}>
            <View style={styles.legend}>
              <Legend color={colors.primary} label="Muscle" />
              <Legend color={colors.blush} label="Fat" />
              <Legend color={colors.info} label="Bone" />
              <Legend color={colors.textStrong} label="Weight" line />
            </View>
            <ScrollView
              accessibilityLabel={`Body composition chart with ${timeline.points.length} readings`}
              contentContainerStyle={styles.chart}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {timeline.points.map((point) => (
                <TrendBar
                  domain={domain}
                  key={point.sessionId}
                  point={point}
                  selected={point.sessionId === selected?.sessionId}
                  unit={timeline.unit}
                  onPress={() => setSelectedSessionId(point.sessionId)}
                />
              ))}
            </ScrollView>
            {timeline.truncated ? <Text style={styles.truncated}>Showing the latest {timeline.points.length} of {timeline.totalPoints} readings.</Text> : null}
          </View>
        ) : null}
        {selected && timeline ? <Inspector point={selected} unit={timeline.unit} /> : null}
      </ScrollView>
    </Screen>
  );
}

function TrendBar({ domain, point, selected, unit, onPress }: {
  domain: number;
  point: BodyTrendPoint;
  selected: boolean;
  unit: string;
  onPress: () => void;
}) {
  const height = (value: number) => Math.max(3, value / domain * chartHeight);
  const weightBottom = point.components.weight === undefined ? undefined : point.components.weight / domain * chartHeight;
  return (
    <Pressable
      accessibilityLabel={`${formatDate(point.date)}. Muscle ${formatValue(point.components.skeletalMuscleMass)} ${unit}, fat ${formatValue(point.components.fatMass)} ${unit}, bone ${formatValue(point.components.boneMineralContent)} ${unit}${point.components.weight === undefined ? ". No weight" : `, weight ${formatValue(point.components.weight)} ${unit}`}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={styles.barSlot}
    >
      <View style={[styles.plot, selected && styles.plotSelected]}>
        {weightBottom !== undefined ? <View style={[styles.weightMarker, { bottom: weightBottom }]} /> : null}
        <View style={styles.stack}>
          <View style={[styles.segment, styles.muscle, { height: height(point.components.skeletalMuscleMass) }]} />
          <View style={[styles.segment, styles.fat, { height: height(point.components.fatMass) }]} />
          <View style={[styles.segment, styles.bone, { height: height(point.components.boneMineralContent) }]} />
        </View>
      </View>
      <Text style={[styles.dateLabel, selected && styles.dateLabelSelected]}>{formatShortDate(point.date)}</Text>
    </Pressable>
  );
}

function Inspector({ point, unit }: { point: BodyTrendPoint; unit: string }) {
  const rows = [
    ["Skeletal muscle", point.components.skeletalMuscleMass, colors.primary],
    ["Fat mass", point.components.fatMass, colors.blush],
    ["Bone mineral", point.components.boneMineralContent, colors.info],
    ["Weight", point.components.weight, colors.textStrong]
  ] as const;
  return (
    <View style={styles.inspector}>
      <View style={styles.inspectorHeader}>
        <View style={styles.inspectorHeading}>
          <Text style={styles.inspectorDate}>{formatDate(point.date)}</Text>
          {point.sourceLabel ? <Text style={styles.source}>{point.sourceLabel}</Text> : null}
        </View>
        <Text style={styles.total}>{formatValue(componentTotal(point))} <Text style={styles.unit}>{unit}</Text></Text>
      </View>
      {rows.map(([label, value, color]) => (
        <View key={label} style={styles.metricRow}>
          <View style={[styles.legendSwatch, { backgroundColor: color }]} />
          <Text style={styles.metricLabel}>{label}</Text>
          <Text style={styles.metricValue}>{value === undefined ? "Not recorded" : `${formatValue(value)} ${unit}`}</Text>
        </View>
      ))}
    </View>
  );
}

function Legend({ color, label, line = false }: { color: string; label: string; line?: boolean }) {
  return <View style={styles.legendItem}><View style={[styles.legendSwatch, line && styles.legendLine, { backgroundColor: color }]} /><Text style={styles.legendText}>{label}</Text></View>;
}

function componentTotal(point: BodyTrendPoint) {
  return point.components.skeletalMuscleMass + point.components.fatMass + point.components.boneMineralContent;
}

function formatValue(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

function formatShortDate(date: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

const styles = StyleSheet.create({
  content: { alignSelf: "center", gap: spacing.md, maxWidth: 680, paddingBottom: spacing.xl, width: "100%" },
  intro: { gap: spacing.xs },
  title: { color: colors.textStrong, fontSize: type.heading, fontWeight: "800" },
  subtitle: { color: colors.muted, fontSize: type.body, lineHeight: 22 },
  rangeControl: { backgroundColor: colors.backgroundRaised, borderRadius: radii.sm, flexDirection: "row", padding: 3 },
  rangeOption: { alignItems: "center", borderRadius: 6, flex: 1, justifyContent: "center", minHeight: 40 },
  rangeOptionActive: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  rangeText: { color: colors.muted, fontSize: type.label, fontWeight: "700" },
  rangeTextActive: { color: colors.primaryStrong },
  errorStack: { gap: spacing.sm },
  chartCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, gap: spacing.md, overflow: "hidden", paddingVertical: spacing.md },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, paddingHorizontal: spacing.md },
  legendItem: { alignItems: "center", flexDirection: "row", gap: spacing.xs },
  legendSwatch: { borderRadius: 3, height: 9, width: 9 },
  legendLine: { borderRadius: 0, height: 2, width: 13 },
  legendText: { color: colors.muted, fontSize: 12 },
  chart: { alignItems: "flex-end", minWidth: "100%", paddingHorizontal: spacing.sm },
  barSlot: { alignItems: "center", gap: spacing.sm, width: 68 },
  plot: { alignItems: "center", borderColor: "transparent", borderRadius: radii.sm, height: chartHeight + 12, justifyContent: "flex-end", paddingHorizontal: spacing.sm, position: "relative", width: 58 },
  plotSelected: { backgroundColor: colors.primaryMuted, borderColor: colors.primary, borderWidth: 1 },
  stack: { alignItems: "stretch", justifyContent: "flex-end", overflow: "hidden", width: 28 },
  segment: { width: "100%" },
  muscle: { backgroundColor: colors.primary },
  fat: { backgroundColor: colors.blush },
  bone: { backgroundColor: colors.info },
  weightMarker: { backgroundColor: colors.textStrong, height: 2, left: 7, position: "absolute", right: 7, zIndex: 2 },
  dateLabel: { color: colors.muted, fontSize: 11, fontWeight: "600" },
  dateLabelSelected: { color: colors.primaryStrong, fontWeight: "800" },
  truncated: { color: colors.muted, fontSize: 12, paddingHorizontal: spacing.md },
  inspector: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  inspectorHeader: { alignItems: "center", flexDirection: "row", gap: spacing.md, justifyContent: "space-between" },
  inspectorHeading: { flex: 1, gap: 2 },
  inspectorDate: { color: colors.textStrong, fontSize: type.title, fontWeight: "800" },
  source: { color: colors.muted, fontSize: 12 },
  total: { color: colors.textStrong, fontSize: type.title, fontWeight: "800" },
  unit: { color: colors.muted, fontSize: type.label, fontWeight: "500" },
  metricRow: { alignItems: "center", borderTopColor: colors.border, borderTopWidth: 1, flexDirection: "row", gap: spacing.sm, minHeight: 38 },
  metricLabel: { color: colors.text, flex: 1, fontSize: type.label },
  metricValue: { color: colors.textStrong, fontSize: type.label, fontWeight: "700" }
});