import { useCallback } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { CompositeNavigationProp, useFocusEffect, useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ChevronRight, Database, MonitorSmartphone, UserRound } from "lucide-react-native";
import { useMobileApi } from "../MobileApiProvider";
import type { RootStackParamList, TabParamList } from "../navigationTypes";
import { Button, Card, Loading, Message, Screen } from "../ui/components";
import { colors, radii, spacing, type } from "../ui/theme";

type DashboardNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList, "Dashboard">,
  NativeStackNavigationProp<RootStackParamList>
>;

export function DashboardScreen() {
  const navigation = useNavigation<DashboardNavigation>();
  const {
    analytics,
    bootstrap,
    connectionState,
    dashboardLoading,
    demoMode,
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
  const visibleMetrics = analytics.latestMetrics.slice(0, 4);
  const connectionLabel = demoMode
    ? "Sample data · read only"
    : connectionState === "online"
      ? "Connected · refreshed just now"
      : `${connectionState.replaceAll("-", " ")} · showing current session data`;
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={dashboardLoading} onRefresh={() => { void refreshDashboard(); }} />}
      >
        <View style={styles.contextPanel}>
          <View style={styles.profileRow}>
            <View style={styles.profileIcon}><UserRound color={colors.primary} size={21} /></View>
            <View style={styles.profileText}>
              <Text style={styles.contextLabel}>Active profile</Text>
              <Text style={styles.title}>{bootstrap.profile.displayName}</Text>
            </View>
          </View>
          <View style={styles.connectionRow}>
            <MonitorSmartphone
              color={demoMode || connectionState === "online" ? colors.success : colors.warning}
              size={17}
            />
            <Text style={demoMode || connectionState === "online" ? styles.online : styles.offline}>
              {connectionLabel}
            </Text>
          </View>
        </View>
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>Latest data</Text>
            <Text style={styles.sectionCopy}>Most recent readings for this profile</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate("Track")}
            style={styles.viewAll}
          >
            <Text style={styles.viewAllText}>View all</Text>
            <ChevronRight color={colors.primary} size={17} />
          </Pressable>
        </View>
        {analytics.latestMetrics.length === 0 ? (
          <Message title="No readings yet" detail="Use Import to sync, scan a report, or enter a reading." />
        ) : (
          <View style={styles.metricGrid}>
            {visibleMetrics.map((metric) => {
              const observed = formatObservedDate(metric.observedAt);
              return (
                <Pressable
                  accessibilityLabel={`${metric.label}, ${metric.value} ${metric.unit}, ${observed}`}
                  accessibilityRole="button"
                  key={metric.code}
                  onPress={() => navigation.navigate("TrackDetail", {
                    measurementCode: metric.code,
                    displayName: metric.label
                  })}
                  style={({ pressed }) => [styles.metricTile, pressed && styles.pressed]}
                >
                  <Text numberOfLines={2} style={styles.metricName}>{metric.label}</Text>
                  <Text numberOfLines={1} adjustsFontSizeToFit style={styles.metricValue}>
                    {metric.value} <Text style={styles.metricUnit}>{metric.unit}</Text>
                  </Text>
                  <Text style={styles.metricDate}>{observed}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
        <View style={styles.recordsSection}>
          <View style={styles.recordsTitleRow}>
            <Database color={colors.muted} size={17} />
            <Text style={styles.recordsTitle}>Stored records</Text>
          </View>
          <View accessibilityLabel="Stored health data totals" style={styles.countRow}>
            {[
              ["Imports", counts.imports],
              ["Observations", counts.observations],
              ["Samples", counts.samples],
              ["Activities", counts.activities]
            ].map(([label, value]) => (
              <View key={String(label)} style={styles.countItem}>
                <Text style={styles.count}>{value}</Text>
                <Text numberOfLines={1} style={styles.label}>{label}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

function formatObservedDate(value: string): string {
  const observed = new Date(value);
  const today = new Date();
  if (observed.toDateString() === today.toDateString()) {
    return `Today, ${observed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  return observed.toLocaleDateString([], { day: "numeric", month: "short" });
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingBottom: spacing.xl },
  contextPanel: { backgroundColor: colors.primaryMuted, borderRadius: radii.lg, gap: spacing.md, padding: spacing.md },
  profileRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  profileIcon: { alignItems: "center", backgroundColor: colors.surface, borderRadius: radii.pill, height: 42, justifyContent: "center", width: 42 },
  profileText: { flex: 1 },
  contextLabel: { color: colors.muted, fontSize: type.label, fontWeight: "700" },
  title: { color: colors.textStrong, fontSize: type.display, fontWeight: "800" },
  connectionRow: { alignItems: "center", borderTopColor: colors.borderStrong, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: spacing.sm, paddingTop: spacing.sm },
  online: { color: colors.success, flex: 1, fontSize: type.body, fontWeight: "600" },
  offline: { color: colors.warning, flex: 1, fontSize: type.body, fontWeight: "600", textTransform: "capitalize" },
  sectionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  sectionTitle: { color: colors.textStrong, fontSize: type.heading, fontWeight: "800" },
  sectionCopy: { color: colors.muted, fontSize: type.label, marginTop: 2 },
  viewAll: { alignItems: "center", flexDirection: "row", minHeight: 44, paddingLeft: spacing.sm },
  viewAllText: { color: colors.primary, fontSize: type.body, fontWeight: "700" },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metricTile: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flexBasis: "47%", flexGrow: 1, gap: spacing.xs, minHeight: 116, padding: spacing.md },
  pressed: { opacity: 0.8 },
  metricName: { color: colors.muted, fontSize: type.label, fontWeight: "700", minHeight: 30 },
  metricValue: { color: colors.primaryStrong, fontSize: 22, fontWeight: "800" },
  metricUnit: { color: colors.muted, fontSize: type.label, fontWeight: "700" },
  metricDate: { color: colors.muted, fontSize: type.label },
  recordsSection: { gap: spacing.sm },
  recordsTitleRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  recordsTitle: { color: colors.text, fontSize: type.title, fontWeight: "700" },
  countRow: { backgroundColor: colors.surfaceMuted, borderRadius: radii.md, flexDirection: "row", paddingVertical: spacing.md },
  countItem: { alignItems: "center", flex: 1, gap: 2, paddingHorizontal: spacing.xs },
  count: { color: colors.textStrong, fontSize: type.title, fontWeight: "800" },
  label: { color: colors.muted, fontSize: 10 }
});
