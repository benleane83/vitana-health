import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { CompositeNavigationProp, useIsFocused, useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, Database, MonitorSmartphone, Pin } from "lucide-react-native";
import { careItemKindLabels, isUtcMidnightTimestamp, type CareItem } from "@vitana/shared";
import { useMobileApi } from "../MobileApiProvider";
import { connectionStateLabel } from "../connectionState";
import type { RootStackParamList, TabParamList } from "../navigationTypes";
import { Button, Card, Loading, Message, Screen } from "../ui/components";
import { colors, radii, spacing, type } from "../ui/theme";
import { ProfileAvatar } from "../ui/ProfileAvatar";
import { dashboardMetrics, formatDashboardMetricValue } from "./dashboardMetrics";

type DashboardNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList, "Dashboard">,
  NativeStackNavigationProp<RootStackParamList>
>;

export function DashboardScreen() {
  const isFocused = useIsFocused();
  const navigation = useNavigation<DashboardNavigation>();
  const {
    analytics,
    bootstrap,
    connectionState,
    dashboardLoading,
    demoMode,
    error,
    profilePhotoUri,
    refreshDashboard,
    listCareItems,
    standaloneMode,
    syncing
  } = useMobileApi();
  const [upcomingCare, setUpcomingCare] = useState<{
    items: CareItem[];
    total: number;
    loading: boolean;
    error?: string;
  }>({ items: [], total: 0, loading: true });

  const loadUpcomingCare = useCallback(async () => {
    setUpcomingCare((current) => ({ ...current, loading: true, error: undefined }));
    try {
      const result = await listCareItems({
        status: "open",
        dueTo: dueWithinThirtyDays(),
        limit: 3,
        offset: 0
      });
      setUpcomingCare({ items: result.items, total: result.total, loading: false });
    } catch {
      setUpcomingCare((current) => ({ ...current, loading: false, error: "Upcoming care could not be loaded." }));
    }
  }, [listCareItems]);

  useEffect(() => {
    if (isFocused) void loadUpcomingCare();
  }, [bootstrap?.profile.id, isFocused, loadUpcomingCare]);

  const refresh = useCallback(async () => {
    await refreshDashboard({ synchronize: true });
    await loadUpcomingCare();
  }, [loadUpcomingCare, refreshDashboard]);

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
        <Button onPress={() => { void refreshDashboard({ synchronize: true }); }}>Retry</Button>
      </Screen>
    );
  }

  const counts = analytics.counts;
  const visibleMetrics = dashboardMetrics(analytics.latestMetrics);
  const connectionLabel = demoMode
    ? "Sample data · edits reset on restart"
    : standaloneMode
      ? "On this phone · encrypted"
      : syncing
        ? "Syncing encrypted data from your PC"
      : connectionState === "online"
        ? "Connected"
        : `${connectionStateLabel(connectionState)} · showing read-only data`;
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={dashboardLoading} onRefresh={() => { void refresh(); }} />}
      >
        <View style={styles.contextPanel}>
          <View style={styles.profileRow}>
            <ProfileAvatar uri={profilePhotoUri} />
            <View style={styles.profileText}>
              <Text style={styles.contextLabel}>Active profile</Text>
              <Text numberOfLines={2} style={styles.title}>{bootstrap.profile.displayName}</Text>
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
          <View style={styles.sectionHeadingText}>
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
              const value = formatDashboardMetricValue(metric.value);
              return (
                <Pressable
                  accessibilityLabel={`${metric.label}, ${value} ${metric.unit}, ${observed}${metric.isPinned ? ", pinned" : ""}`}
                  accessibilityRole="button"
                  key={metric.code}
                  onPress={() => navigation.navigate("TrackDetail", {
                    measurementCode: metric.code,
                    displayName: metric.label
                  })}
                  style={({ pressed }) => [styles.metricTile, pressed && styles.pressed]}
                >
                  <View style={styles.metricHeading}>
                    <Text numberOfLines={2} style={styles.metricName}>{metric.label}</Text>
                    {metric.isPinned ? <Pin accessibilityElementsHidden color={colors.primary} fill={colors.primary} size={15} /> : null}
                  </View>
                  <Text numberOfLines={1} adjustsFontSizeToFit style={styles.metricValue}>
                    {value} <Text style={styles.metricUnit}>{metric.unit}</Text>
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
            <Text style={styles.recordsTitle}>Profile summary</Text>
          </View>
          <View accessibilityLabel="Stored health data totals" style={styles.countRow}>
            {[
              ["Imports", counts.imports],
              ["Observations", counts.observations],
              ["Samples", counts.samples],
              ["Activities", counts.activities]
            ].map(([label, value]) => (
              <View key={String(label)} style={styles.countItem}>
                <Text adjustsFontSizeToFit numberOfLines={1} style={styles.count}>{formatCount(Number(value))}</Text>
                <Text numberOfLines={1} style={styles.label}>{label}</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={styles.careSection}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeadingText}>
              <Text style={styles.sectionTitle}>Upcoming care</Text>
              <Text style={styles.sectionCopy}>
                {upcomingCare.total > 0
                  ? formatCareSummary(upcomingCare.total)
                  : "A 30-day view of care that needs attention"}
              </Text>
            </View>
            {!upcomingCare.loading && !upcomingCare.error && upcomingCare.total > 0 ? (
              <Pressable
                accessibilityLabel="View all upcoming care"
                accessibilityRole="button"
                onPress={() => navigation.navigate("Care", { view: "items" })}
                style={styles.viewAll}
              >
                <Text style={styles.viewAllText}>View all</Text>
                <ChevronRight color={colors.primary} size={17} />
              </Pressable>
            ) : null}
          </View>
          {upcomingCare.loading ? (
            <View accessibilityLabel="Loading upcoming care" accessibilityRole="progressbar" style={styles.careList}>
              {[0, 1, 2].map((index) => (
                <View key={index} style={[styles.careLoadingRow, index > 0 && styles.careDivider]}>
                  <View style={styles.careLoadingIcon} />
                  <View style={styles.careLoadingCopy}>
                    <View style={styles.careLoadingTitle} />
                    <View style={styles.careLoadingMeta} />
                  </View>
                </View>
              ))}
            </View>
          ) : upcomingCare.error ? (
            <View accessibilityRole="alert" style={[styles.careState, styles.careError]}>
              <AlertTriangle color={colors.danger} size={18} />
              <Text style={styles.careStateText}>{upcomingCare.error}</Text>
              <Pressable accessibilityRole="button" onPress={() => { void loadUpcomingCare(); }}>
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          ) : upcomingCare.items.length > 0 ? (
            <View style={styles.careList}>
              {upcomingCare.items.map((item, index) => {
                const dueText = formatRelativeDueDate(item.dueStart);
                const overdue = isOverdue(item);
                return (
                  <Pressable
                    accessibilityHint="Opens this care item for editing"
                    accessibilityLabel={`${item.title}, ${careItemKindLabels[item.kind]}, ${dueText}`}
                    accessibilityRole="button"
                    key={item.id}
                    onPress={() => navigation.navigate("Care", { view: "items", editCareItemId: item.id })}
                    style={({ pressed }) => [
                      styles.careRow,
                      index > 0 && styles.careDivider,
                      overdue && styles.careRowOverdue,
                      pressed && styles.pressed
                    ]}
                  >
                    <View style={[styles.careIcon, overdue && styles.careIconOverdue]}>
                      {overdue
                        ? <AlertTriangle color={colors.danger} size={18} />
                        : <CalendarClock color={colors.primary} size={18} />}
                    </View>
                    <View style={styles.careCopy}>
                      <Text numberOfLines={1} style={styles.careTitle}>{item.title}</Text>
                      <Text style={styles.careKind}>{careItemKindLabels[item.kind]}</Text>
                    </View>
                    <Text numberOfLines={2} style={[styles.careDue, overdue && styles.careDueOverdue]}>{dueText}</Text>
                    <ChevronRight color={colors.muted} size={18} />
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <View accessibilityRole="text" style={styles.careState}>
              <CheckCircle2 color={colors.success} size={18} />
              <Text style={styles.careStateText}>Nothing due in the next 30 days.</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

function formatObservedDate(value: string): string {
  const observed = new Date(value);
  if (!Number.isFinite(observed.getTime())) return "Date unavailable";
  if (isUtcMidnightTimestamp(value)) {
    return observed.toLocaleDateString([], { day: "numeric", month: "short", timeZone: "UTC" });
  }
  const today = new Date();
  if (observed.toDateString() === today.toDateString()) {
    return `Today, ${observed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  return observed.toLocaleDateString([], { day: "numeric", month: "short" });
}

function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(undefined, { notation: value >= 100_000 ? "compact" : "standard" }).format(value);
}

function dueWithinThirtyDays(now = new Date()): string {
  const dueTo = new Date(now);
  dueTo.setDate(dueTo.getDate() + 30);
  return dueTo.toISOString();
}

function formatCareSummary(total: number): string {
  return `${total} ${total === 1 ? "item needs" : "items need"} attention in the next 30 days`;
}

function isOverdue(item: CareItem): boolean {
  return item.dueStart ? daysFromToday(item.dueStart) < 0 : false;
}

function formatRelativeDueDate(value?: string): string {
  if (!value) return "Date unavailable";
  const days = daysFromToday(value);
  if (days < 0) return `Overdue ${Math.abs(days)}d`;
  if (days === 0) return "Due today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

function daysFromToday(value: string): number {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 0;
  const now = new Date();
  const dueDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((dueDay - today) / 86_400_000);
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingBottom: spacing.xl },
  contextPanel: { backgroundColor: colors.primaryMuted, borderRadius: radii.lg, gap: spacing.md, padding: spacing.md },
  profileRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  profileText: { flex: 1, minWidth: 0 },
  contextLabel: { color: colors.muted, fontSize: type.label, fontWeight: "700" },
  title: { color: colors.textStrong, fontSize: type.display, fontWeight: "800" },
  connectionRow: { alignItems: "center", borderTopColor: colors.borderStrong, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: spacing.sm, paddingTop: spacing.sm },
  online: { color: colors.success, flex: 1, fontSize: type.body, fontWeight: "600" },
  offline: { color: colors.warning, flex: 1, fontSize: type.body, fontWeight: "600", textTransform: "capitalize" },
  sectionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  sectionHeadingText: { flex: 1, minWidth: 0 },
  sectionTitle: { color: colors.textStrong, fontSize: type.heading, fontWeight: "800" },
  sectionCopy: { color: colors.muted, fontSize: type.label, marginTop: 2 },
  viewAll: { alignItems: "center", flexDirection: "row", flexShrink: 0, minHeight: 44, paddingLeft: spacing.sm },
  viewAllText: { color: colors.primary, fontSize: type.body, fontWeight: "700" },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metricTile: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flexBasis: "47%", flexGrow: 1, gap: spacing.xs, minHeight: 128, padding: spacing.md },
  metricHeading: { alignItems: "flex-start", flexDirection: "row", gap: spacing.xs, justifyContent: "space-between" },
  pressed: { opacity: 0.8 },
  metricName: { color: colors.muted, flex: 1, fontSize: type.label, fontWeight: "700", minHeight: 30 },
  metricValue: { color: colors.primaryStrong, fontSize: 22, fontWeight: "800" },
  metricUnit: { color: colors.muted, fontSize: type.label, fontWeight: "700" },
  metricDate: { color: colors.muted, fontSize: type.label },
  recordsSection: { gap: spacing.sm },
  recordsTitleRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  recordsTitle: { color: colors.text, fontSize: type.title, fontWeight: "700" },
  countRow: { backgroundColor: colors.surfaceMuted, borderRadius: radii.md, flexDirection: "row", paddingVertical: spacing.md },
  countItem: { alignItems: "center", flex: 1, gap: spacing.xs, minWidth: 0, paddingHorizontal: spacing.xs },
  count: { color: colors.textStrong, fontSize: type.title, fontWeight: "800" },
  label: { color: colors.muted, fontSize: 13, lineHeight: 18, textAlign: "center" },
  careSection: { gap: spacing.sm },
  careList: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, overflow: "hidden" },
  careRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm, minHeight: 68, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  careRowOverdue: { backgroundColor: colors.dangerMuted },
  careDivider: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  careIcon: { alignItems: "center", backgroundColor: colors.primaryMuted, borderRadius: radii.sm, height: 36, justifyContent: "center", width: 36 },
  careIconOverdue: { backgroundColor: colors.surface },
  careCopy: { flex: 1, minWidth: 0 },
  careTitle: { color: colors.textStrong, fontSize: type.body, fontWeight: "700" },
  careKind: { color: colors.muted, fontSize: type.label, marginTop: 2 },
  careDue: { color: colors.muted, fontSize: type.label, fontWeight: "700", maxWidth: 82, textAlign: "right" },
  careDueOverdue: { color: colors.danger },
  careState: { alignItems: "center", backgroundColor: colors.surfaceMuted, borderRadius: radii.md, flexDirection: "row", gap: spacing.sm, minHeight: 58, padding: spacing.md },
  careStateText: { color: colors.muted, flex: 1, fontSize: type.label, lineHeight: 19 },
  careError: { backgroundColor: colors.dangerMuted },
  retryText: { color: colors.danger, fontSize: type.label, fontWeight: "800", paddingVertical: spacing.sm },
  careLoadingRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm, height: 68, paddingHorizontal: spacing.md },
  careLoadingIcon: { backgroundColor: colors.surfaceMuted, borderRadius: radii.sm, height: 36, width: 36 },
  careLoadingCopy: { flex: 1, gap: spacing.sm },
  careLoadingTitle: { backgroundColor: colors.surfaceMuted, borderRadius: radii.sm, height: 12, width: "62%" },
  careLoadingMeta: { backgroundColor: colors.surfaceMuted, borderRadius: radii.sm, height: 10, width: "38%" }
});
