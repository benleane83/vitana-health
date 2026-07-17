import { Fragment, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";
import {
  calculateChartDomain,
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
  const { healthDataDetail } = useMobileApi();
  const [detail, setDetail] = useState<HealthDataDetail>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

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

  if (loading) return <Screen><Loading label="Loading metric…" /></Screen>;
  if (!detail) return <Screen><Message title="Metric unavailable" detail={error} /></Screen>;
  const latest = detail.entries[0];

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        {latest ? (
          <Card>
            <Text style={styles.label}>Latest</Text>
            <Text adjustsFontSizeToFit numberOfLines={1} style={styles.latest}>{latest.value} {latest.unit}</Text>
            <Text style={styles.meta}>{formatTimestamp(latest.timestamp)}</Text>
          </Card>
        ) : <Message title="No history yet" />}
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
          </Card>
        ))}
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
  return Number.isFinite(timestamp.getTime()) ? timestamp.toLocaleString() : "Date unavailable";
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
  const domain = calculateChartDomain(detail.chartPoints);
  const latestPoint = detail.chartPoints.at(-1);
  const [selectedTimestamp, setSelectedTimestamp] = useState(latestPoint?.timestamp);

  useEffect(() => {
    setSelectedTimestamp(latestPoint?.timestamp);
  }, [detail.measurement.code, latestPoint?.timestamp]);

  if (!domain) return <Text style={styles.meta}>No numeric trend points.</Text>;
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
      <Svg accessibilityLabel={`${detail.measurement.displayName} trend with ${points.length} selectable points`} height={height} width="100%" viewBox={`0 0 ${width} ${height}`}>
        {yTicks.map((tick) => {
          const y = chartBottom - ((tick - domain.yMin) / yRange) * (chartBottom - chartTop);
          return (
            <Line key={tick} x1={chartLeft} x2={chartRight} y1={y} y2={y} stroke={colors.border} strokeWidth={1} />
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
  label: { color: colors.muted, fontSize: 14, fontWeight: "700" },
  latest: { color: colors.text, fontSize: 28, fontWeight: "800" },
  heading: { color: colors.text, fontSize: 18, fontWeight: "800" },
  row: { flexDirection: "row", justifyContent: "space-between" },
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
