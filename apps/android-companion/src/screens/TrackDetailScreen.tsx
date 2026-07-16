import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import Svg, { Circle, Path } from "react-native-svg";
import { calculateChartDomain, mergeHealthDataDetail, type HealthDataDetail } from "@local-fitness-advisor/shared";
import { createCompanionApi } from "../api";
import { useMobileApi } from "../MobileApiProvider";
import type { RootStackParamList } from "../navigationTypes";
import { Button, Card, Loading, Message, Screen } from "../ui/components";
import { colors, spacing } from "../ui/theme";

type Props = NativeStackScreenProps<RootStackParamList, "TrackDetail">;

export function TrackDetailScreen({ route }: Props) {
  const { connection } = useMobileApi();
  const [detail, setDetail] = useState<HealthDataDetail>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const client = useMemo(() => connection?.token ? createCompanionApi(connection) : undefined, [connection]);

  useEffect(() => {
    let current = true;
    setDetail(undefined);
    setLoading(true);
    setError(undefined);
    if (!client) {
      setLoading(false);
      return () => { current = false; };
    }
    void client.healthDataDetail(route.params.measurementCode).then((value) => {
      if (current) setDetail(value);
    }).catch((caught: unknown) => {
      if (current) setError(caught instanceof Error ? caught.message : "Unable to load metric.");
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [client, route.params.measurementCode]);

  async function loadMore() {
    if (!client || !detail?.pagination.hasMore) return;
    setLoadingMore(true);
    try {
      const next = await client.healthDataDetail(route.params.measurementCode, {
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
            <Text style={styles.latest}>{latest.value} {latest.unit}</Text>
            <Text style={styles.meta}>{new Date(latest.timestamp).toLocaleString()}</Text>
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
                <Text style={styles.meta}>{new Date(entry.timestamp).toLocaleString()}</Text>
                <Text style={styles.meta}>
                  {[entry.sourceLabel, entry.importFileName, entry.observationGroup?.label].filter(Boolean).join(" · ") || "Local record"}
                </Text>
              </View>
              <Text style={styles.kind}>{entry.kind}</Text>
            </View>
          </Card>
        ))}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {detail.pagination.hasMore ? (
          <Button disabled={loadingMore} onPress={() => { void loadMore(); }}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function TrendChart({ detail }: { detail: HealthDataDetail }) {
  const domain = calculateChartDomain(detail.chartPoints);
  if (!domain) return <Text style={styles.meta}>No numeric trend points.</Text>;
  const width = 320;
  const height = 130;
  const xRange = domain.xMax - domain.xMin || 1;
  const yRange = domain.yMax - domain.yMin || 1;
  const points = detail.chartPoints.map((point) => ({
    x: 12 + ((Date.parse(point.timestamp) - domain.xMin) / xRange) * (width - 24),
    y: height - 12 - ((point.value - domain.yMin) / yRange) * (height - 24)
  }));
  const path = points.map((point, index) =>
    `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  return (
    <Svg accessibilityLabel={`${detail.measurement.displayName} trend with ${points.length} points`} height={height} width="100%" viewBox={`0 0 ${width} ${height}`}>
      <Path d={path} fill="none" stroke={colors.primary} strokeWidth={3} />
      {points.map((point, index) => <Circle key={index} cx={point.x} cy={point.y} fill={colors.primary} r={4} />)}
    </Svg>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  label: { color: colors.muted, fontSize: 12, fontWeight: "700", textTransform: "uppercase" },
  latest: { color: colors.text, fontSize: 28, fontWeight: "800" },
  heading: { color: colors.text, fontSize: 18, fontWeight: "800" },
  row: { flexDirection: "row", justifyContent: "space-between" },
  flex: { flex: 1, gap: spacing.xs },
  value: { color: colors.text, fontSize: 17, fontWeight: "700" },
  meta: { color: colors.muted, fontSize: 13 },
  kind: { color: colors.primary, fontSize: 12, textTransform: "capitalize" },
  error: { color: colors.danger }
});
