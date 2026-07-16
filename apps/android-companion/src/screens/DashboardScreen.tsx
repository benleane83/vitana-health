import { useCallback } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMobileApi } from "../MobileApiProvider";
import type { RootStackParamList } from "../navigationTypes";
import { Button, Card, Loading, Message, Screen } from "../ui/components";
import { colors, spacing } from "../ui/theme";

export function DashboardScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {
    analytics,
    bootstrap,
    connectionState,
    dashboardLoading,
    error,
    refreshDashboard
  } = useMobileApi();

  useFocusEffect(useCallback(() => { void refreshDashboard(); }, [refreshDashboard]));

  if (connectionState === "unpaired" || connectionState === "re-pair-required") {
    return (
      <Screen>
        <Message
          title={connectionState === "re-pair-required" ? "Re-pair required" : "Connect to your PC"}
          detail="Pair this phone to one profile before viewing health data."
        />
        <Button onPress={() => navigation.navigate("Pair")}>Set up connection</Button>
      </Screen>
    );
  }
  if (dashboardLoading && !analytics) return <Screen><Loading label="Loading dashboard…" /></Screen>;
  if (!analytics || !bootstrap) {
    return (
      <Screen>
        <Message
          title={connectionState === "maintenance" ? "PC maintenance in progress" : "PC unavailable"}
          detail={error ?? "Dashboard data remains on your PC. Reconnect to view it."}
        />
        <Button onPress={() => { void refreshDashboard(); }}>Retry</Button>
      </Screen>
    );
  }

  const counts = analytics.counts;
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={dashboardLoading} onRefresh={() => { void refreshDashboard(); }} />}
      >
        <View>
          <Text style={styles.eyebrow}>Assigned profile</Text>
          <Text style={styles.title}>{bootstrap.profile.displayName}</Text>
          <Text style={styles.online}>● Online · refreshed just now</Text>
        </View>
        <View style={styles.grid}>
          {[
            ["Imports", counts.imports],
            ["Observations", counts.observations],
            ["Samples", counts.samples],
            ["Activities", counts.activities]
          ].map(([label, value]) => (
            <Card key={String(label)}>
              <Text style={styles.count}>{value}</Text>
              <Text style={styles.label}>{label}</Text>
            </Card>
          ))}
        </View>
        <Text style={styles.sectionTitle}>Latest metrics</Text>
        {analytics.latestMetrics.length === 0 ? (
          <Message title="No metrics yet" detail="Use Import to add a report, manual entry, or Health Connect data." />
        ) : analytics.latestMetrics.map((metric) => (
          <Pressable
            accessibilityRole="button"
            key={metric.code}
            onPress={() => navigation.navigate("TrackDetail", {
              measurementCode: metric.code,
              displayName: metric.label
            })}
          >
            <Card>
              <View style={styles.metricRow}>
                <View>
                  <Text style={styles.metricName}>{metric.label}</Text>
                  <Text style={styles.label}>{new Date(metric.observedAt).toLocaleDateString()}</Text>
                </View>
                <Text style={styles.metricValue}>{metric.value} {metric.unit}</Text>
              </View>
            </Card>
          </Pressable>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  eyebrow: { color: colors.muted, fontSize: 12, fontWeight: "700", textTransform: "uppercase" },
  title: { color: colors.text, fontSize: 26, fontWeight: "800" },
  online: { color: colors.success, marginTop: spacing.xs },
  grid: { gap: spacing.sm },
  count: { color: colors.text, fontSize: 24, fontWeight: "800" },
  label: { color: colors.muted, fontSize: 13 },
  sectionTitle: { color: colors.text, fontSize: 19, fontWeight: "800" },
  metricRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  metricName: { color: colors.text, fontSize: 16, fontWeight: "700" },
  metricValue: { color: colors.primary, fontSize: 16, fontWeight: "800" }
});
