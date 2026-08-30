import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, RefreshControl, ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { CompositeNavigationProp, useIsFocused, useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  MonitorSmartphone,
  Pin,
  RefreshCw
} from "lucide-react-native";
import {
  careItemKindLabels,
  isUtcMidnightTimestamp,
  type CareItem,
  type ProfileDataCategory
} from "@vitana/shared";
import { useMobileApi } from "../MobileApiProvider";
import { connectionStateLabel } from "../connectionState";
import { latestHealthSourceCursor } from "../healthSourceCursor";
import { activeHealthSourceProvider } from "../healthSourceProvider";
import type { RootStackParamList, TabParamList } from "../navigationTypes";
import { Button, Loading, Message, Screen } from "../ui/components";
import { colors, radii, spacing, type } from "../ui/theme";
import { ProfileAvatar } from "../ui/ProfileAvatar";
import { useHealthSourceSync } from "../useHealthSourceSync";
import {
  dashboardCategoryCounts,
  dashboardMetrics,
  formatDashboardMetricValue,
  formatLabReference,
  formatLabValue,
  formatTrendSummary,
  sparklineGeometry
} from "./dashboardMetrics";
import { TrendSparkline } from "./TrendSparkline";

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
    connection,
    connectionState,
    dashboardLoading,
    demoMode,
    error,
    profilePhotoUri,
    refreshDashboard,
    refreshTrack,
    listCareItems,
    summary,
    standaloneMode,
    syncing,
    trackLoading
  } = useMobileApi();
  const healthSourceSync = useHealthSourceSync();
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
    await refreshTrack();
    await loadUpcomingCare();
  }, [loadUpcomingCare, refreshDashboard, refreshTrack]);

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

  const visibleMetrics = dashboardMetrics(analytics.latestMetrics);
  const categoryCounts = dashboardCategoryCounts(summary);
  const healthSourceProvider = activeHealthSourceProvider();
  const healthSourceConfigured = Boolean(
    !demoMode &&
    !standaloneMode &&
    connection?.token &&
    connection.healthConnectDisclosureAcknowledged &&
    connection.healthSourceCategories.length > 0 &&
    healthSourceProvider
  );
  const lastHealthSourceSync = connection
    ? latestHealthSourceCursor(connection.healthSourceCursors, connection.healthSourceCategories)
    : null;
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
        refreshControl={<RefreshControl refreshing={dashboardLoading || trackLoading} onRefresh={() => { void refresh(); }} />}
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
          {healthSourceConfigured ? (
            <View style={styles.healthSyncSection}>
              <View style={styles.healthSyncRow}>
                {healthSourceSync.syncing
                  ? <ActivityIndicator color={colors.primary} size="small" />
                  : <RefreshCw color={colors.muted} size={17} />}
                <View style={styles.healthSyncCopy}>
                  <Text style={styles.healthSyncProvider}>{healthSourceProvider?.label}</Text>
                  <Text numberOfLines={1} style={styles.healthSyncStatus}>
                    {healthSourceSync.syncing
                      ? healthSourceSync.syncProgress || "Starting sync…"
                      : formatLastHealthSourceSync(lastHealthSourceSync)}
                  </Text>
                </View>
                <Pressable
                  accessibilityHint="Imports new health data using your saved sync settings"
                  accessibilityRole="button"
                  accessibilityState={{ busy: healthSourceSync.syncing, disabled: healthSourceSync.syncing }}
                  disabled={healthSourceSync.syncing}
                  onPress={() => { void healthSourceSync.sync(); }}
                  style={({ pressed }) => [styles.syncAction, pressed && styles.pressed]}
                >
                  <Text style={[styles.syncActionText, healthSourceSync.syncing && styles.syncActionDisabled]}>
                    {healthSourceSync.syncing ? "Syncing…" : "Sync now"}
                  </Text>
                </Pressable>
              </View>
              {healthSourceSync.statusTone === "danger" && healthSourceSync.status ? (
                <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.healthSyncError}>
                  <AlertTriangle color={colors.danger} size={15} />
                  <Text style={styles.healthSyncErrorText}>{healthSourceSync.status}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeadingText}>
            <Text style={styles.sectionTitle}>Latest data</Text>
            <Text style={styles.sectionCopy}>Most recent readings for this profile</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate("TrackMetrics")}
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
        <View style={styles.summarySection}>
          <Text style={styles.sectionTitle}>Summary</Text>
          {trackLoading && !summary ? (
            <View accessibilityLabel="Loading stored health data totals" accessibilityRole="progressbar" style={styles.summaryList}>
              {[0, 1, 2, 3].map((index) => (
                <View key={index} style={[styles.summaryLoadingRow, index > 0 && styles.summaryDivider]}>
                  <View style={styles.summaryLoadingIcon} />
                  <View style={styles.summaryLoadingLabel} />
                  <View style={styles.summaryLoadingCount} />
                </View>
              ))}
            </View>
          ) : summary ? (
            <View accessibilityLabel="Stored health data totals" style={styles.summaryList}>
              {categoryCounts.map((category, index) => {
                return (
                  <Pressable
                    accessibilityLabel={`View ${category.label}: ${category.count} entries in Measurements`}
                    accessibilityRole="button"
                    key={category.key}
                    onPress={() => navigation.navigate("TrackMetrics", { category: category.key })}
                    style={({ pressed }) => [
                      styles.summaryRow,
                      index > 0 && styles.summaryDivider,
                      pressed && styles.summaryRowPressed
                    ]}
                  >
                    <Image
                      accessibilityIgnoresInvertColors
                      accessible={false}
                      resizeMode="contain"
                      source={categoryIcons[category.key]}
                      style={styles.summaryIcon}
                    />
                    <Text numberOfLines={1} style={styles.summaryLabel}>{category.label}</Text>
                    <Text adjustsFontSizeToFit numberOfLines={1} style={styles.summaryCount}>{formatCount(category.count)}</Text>
                    <ChevronRight color={colors.muted} size={18} />
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <View accessibilityRole="alert" style={styles.summaryUnavailable}>
              <Text style={styles.summaryUnavailableText}>Profile summary could not be loaded.</Text>
              <Pressable accessibilityRole="button" onPress={() => { void refreshTrack(); }} style={styles.summaryRetry}>
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          )}
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
        <View style={styles.deeperSection}>
          <View style={styles.sectionHeadingText}>
            <Text style={styles.sectionTitle}>Trend traces</Text>
            <Text style={styles.sectionCopy}>Recent movement across your measurements</Text>
          </View>
          {analytics.trendCards.length > 0 ? (
            <View style={styles.reviewList}>
              {analytics.trendCards.map((card, index) => {
                const summaryText = formatTrendSummary(card.label, card.summary);
                const geometry = sparklineGeometry(card.points, 112, 48);
                const rangeText = geometry
                  ? `${geometry.count} readings, from ${formatLabValue(geometry.min)} to ${formatLabValue(geometry.max)} ${card.unit}`
                  : "Trend values unavailable";
                return (
                  <Pressable
                    accessibilityLabel={`View details for ${card.label} trend, ${summaryText}, ${rangeText}`}
                    accessibilityRole="button"
                    key={card.code}
                    onPress={() => navigation.navigate("TrackDetail", {
                      measurementCode: card.code,
                      displayName: card.label
                    })}
                    style={({ pressed }) => [
                      styles.trendRow,
                      index > 0 && styles.reviewDivider,
                      pressed && styles.reviewRowPressed
                    ]}
                  >
                    <View style={styles.trendCopy}>
                      <Text style={styles.reviewTitle}>{card.label}</Text>
                      <Text style={styles.reviewSummary}>{summaryText}</Text>
                    </View>
                    <TrendSparkline points={card.points} />
                    <ChevronRight color={colors.muted} size={18} />
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <View style={styles.reviewEmpty}>
              <Text style={styles.reviewEmptyText}>Two or more dated readings are needed for trend traces.</Text>
            </View>
          )}
        </View>
        <View style={styles.deeperSection}>
          <View style={styles.sectionHeadingText}>
            <Text style={styles.sectionTitle}>Range Review</Text>
            <Text style={styles.sectionCopy}>Stored results outside their recorded reference range</Text>
          </View>
          {analytics.rangeAlerts.length > 0 ? (
            <View style={styles.reviewList}>
              {analytics.rangeAlerts.map((alert, index) => {
                const value = formatLabValue(alert.value);
                const reference = alert.reference ? formatLabReference(alert.reference) : undefined;
                const flag = formatLabFlag(alert.flag);
                const observed = formatObservedDate(alert.observedAt);
                return (
                  <Pressable
                    accessibilityLabel={`View details for ${alert.marker}, ${value} ${alert.unit}, ${observed}, ${flag}${reference ? `, reference ${reference}` : ""}`}
                    accessibilityRole="button"
                    key={`${alert.code}-${alert.observedAt}`}
                    onPress={() => navigation.navigate("TrackDetail", {
                      measurementCode: alert.code,
                      displayName: alert.marker
                    })}
                    style={({ pressed }) => [
                      styles.labRow,
                      index > 0 && styles.reviewDivider,
                      pressed && styles.reviewRowPressed
                    ]}
                  >
                    <View style={styles.labCopy}>
                      <View style={styles.labHeading}>
                        <Text numberOfLines={2} style={styles.reviewTitle}>{alert.marker}</Text>
                        <Text style={styles.labDate}>{observed}</Text>
                      </View>
                      <Text style={styles.labValue}>
                        {value} <Text style={styles.labUnit}>{alert.unit}</Text>
                      </Text>
                      <Text style={styles.labRange}>
                        {flag}{reference ? ` · ref ${reference}` : ""}
                      </Text>
                    </View>
                    <ChevronRight color={colors.muted} size={18} />
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <View style={styles.reviewEmpty}>
              <Text style={styles.reviewEmptyText}>No out-of-range results yet.</Text>
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

function formatLabFlag(flag: "low" | "high" | "critical" | "unknown"): string {
  if (flag === "unknown") return "Range unavailable";
  return `${flag.charAt(0).toUpperCase()}${flag.slice(1)}`;
}

function formatLastHealthSourceSync(value: string | null): string {
  if (!value) return "Not synced yet";
  const synced = new Date(value);
  if (!Number.isFinite(synced.getTime())) return "Last sync unavailable";
  const today = new Date();
  const time = synced.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (synced.toDateString() === today.toDateString()) return `Last synced today at ${time}`;
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (synced.toDateString() === yesterday.toDateString()) return `Last synced yesterday at ${time}`;
  return `Last synced ${synced.toLocaleDateString([], { day: "numeric", month: "short", year: synced.getFullYear() === today.getFullYear() ? undefined : "numeric" })}`;
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
  healthSyncSection: { borderTopColor: colors.borderStrong, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.xs },
  healthSyncRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm, minHeight: 44 },
  healthSyncCopy: { flex: 1, minWidth: 0 },
  healthSyncProvider: { color: colors.text, fontSize: type.label, fontWeight: "700" },
  healthSyncStatus: { color: colors.muted, fontSize: 13, marginTop: 1 },
  syncAction: { alignItems: "center", justifyContent: "center", minHeight: 44, paddingLeft: spacing.sm },
  syncActionText: { color: colors.primary, fontSize: type.label, fontWeight: "800" },
  syncActionDisabled: { color: colors.muted },
  healthSyncError: { alignItems: "flex-start", flexDirection: "row", gap: spacing.sm, paddingBottom: spacing.sm },
  healthSyncErrorText: { color: colors.danger, flex: 1, fontSize: 13, lineHeight: 18 },
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
  summarySection: { gap: spacing.sm },
  summaryList: {
    backgroundColor: colors.lavenderMuted,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    overflow: "hidden"
  },
  summaryRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 58,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  summaryRowPressed: { backgroundColor: colors.primaryMuted },
  summaryDivider: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  summaryIcon: { height: 34, width: 34 },
  summaryLabel: { color: colors.text, flex: 1, fontSize: type.body, fontWeight: "700", minWidth: 0 },
  summaryCount: { color: colors.textStrong, fontSize: type.body, fontWeight: "800", maxWidth: 92, textAlign: "right" },
  summaryLoadingRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm, height: 58, paddingHorizontal: spacing.md },
  summaryLoadingIcon: { backgroundColor: colors.surface, borderRadius: radii.pill, height: 36, width: 36 },
  summaryLoadingLabel: { backgroundColor: colors.surface, borderRadius: radii.sm, flex: 1, height: 14 },
  summaryLoadingCount: { backgroundColor: colors.surface, borderRadius: radii.sm, height: 14, width: 34 },
  summaryUnavailable: {
    alignItems: "center",
    backgroundColor: colors.warningMuted,
    borderRadius: radii.md,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 58,
    paddingHorizontal: spacing.md
  },
  summaryUnavailableText: { color: colors.warning, flex: 1, fontSize: type.label, lineHeight: 19 },
  summaryRetry: { justifyContent: "center", minHeight: 44 },
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
  careLoadingMeta: { backgroundColor: colors.surfaceMuted, borderRadius: radii.sm, height: 10, width: "38%" },
  deeperSection: { gap: spacing.sm },
  reviewList: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: "hidden"
  },
  reviewDivider: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  reviewRowPressed: { backgroundColor: colors.surfaceMuted },
  trendRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 78,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  trendCopy: { flex: 1, gap: spacing.xs, minWidth: 0 },
  reviewTitle: { color: colors.textStrong, flexShrink: 1, fontSize: type.body, fontWeight: "800" },
  reviewSummary: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  reviewEmpty: { backgroundColor: colors.surfaceMuted, borderRadius: radii.md, padding: spacing.md },
  reviewEmptyText: { color: colors.muted, fontSize: type.label, lineHeight: 19 },
  labRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 96,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md
  },
  labCopy: { flex: 1, gap: spacing.xs, minWidth: 0 },
  labHeading: { alignItems: "baseline", flexDirection: "row", gap: spacing.sm, justifyContent: "space-between" },
  labDate: { color: colors.muted, flexShrink: 0, fontSize: 12 },
  labValue: { color: colors.primaryStrong, fontSize: type.title, fontWeight: "800" },
  labUnit: { color: colors.muted, fontSize: type.label, fontWeight: "700" },
  labRange: { color: colors.warning, fontSize: 13, fontWeight: "700", lineHeight: 18 }
});

const categoryIcons = {
  activity: require("../../assets/profile-navigation/activity.png"),
  body: require("../../assets/profile-navigation/body-composition.png"),
  lab: require("../../assets/profile-navigation/lab-results.png"),
  sleep: require("../../assets/profile-navigation/sleep.png")
} satisfies Record<ProfileDataCategory, number>;
