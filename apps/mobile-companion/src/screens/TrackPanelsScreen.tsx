import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Picker } from "@react-native-picker/picker";
import { CalendarDays, ChevronRight } from "lucide-react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  observationGroupKindLabel,
  type ObservationGroupKind,
  type ObservationGroupListItem,
  type ObservationGroupListQuery
} from "@vitana/shared";
import { useMobileApi } from "../MobileApiProvider";
import type { RootStackParamList } from "../navigationTypes";
import { Button, Card, Loading, Message, Screen } from "../ui/components";
import { colors, radii, spacing, type } from "../ui/theme";
import { userFacingError } from "../userFacingError";

const pageSize = 50;
const groupKinds: ObservationGroupKind[] = [
  "lab_panel",
  "body_composition_report",
  "activity_session",
  "import_batch",
  "custom"
];

type Props = NativeStackScreenProps<RootStackParamList, "TrackPanels">;
type Filters = Pick<ObservationGroupListQuery, "kinds" | "dateFrom" | "dateTo">;

export function TrackPanelsScreen({ navigation }: Props) {
  const { listObservationGroups } = useMobileApi();
  const [filters, setFilters] = useState<Filters>({});
  const [items, setItems] = useState<ObservationGroupListItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [moreError, setMoreError] = useState<string>();
  const requestSequence = useRef(0);
  const loadingMoreRef = useRef(false);
  const hasFilters = Boolean(filters.kinds?.length || filters.dateFrom || filters.dateTo);
  const invalidRange = Boolean(filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo);

  const loadFirstPage = useCallback(async (refresh = false) => {
    if (invalidRange) return;
    const sequence = ++requestSequence.current;
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(undefined);
    setMoreError(undefined);
    try {
      const page = await listObservationGroups({ ...filters, limit: pageSize, offset: 0 });
      if (requestSequence.current !== sequence) return;
      setItems(page.items);
      setHasMore(page.hasMore);
    } catch (caught: unknown) {
      if (requestSequence.current === sequence) {
        setError(userFacingError(caught, "Unable to load panels. Try again."));
      }
    } finally {
      if (requestSequence.current === sequence) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [filters, invalidRange, listObservationGroups]);

  useEffect(() => {
    void loadFirstPage();
    return () => { requestSequence.current += 1; };
  }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMoreRef.current || loading || refreshing || invalidRange) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setMoreError(undefined);
    try {
      const page = await listObservationGroups({ ...filters, limit: pageSize, offset: items.length });
      setItems((current) => [...current, ...page.items.filter((entry) => !current.some((existing) => existing.id === entry.id))]);
      setHasMore(page.hasMore);
    } catch (caught: unknown) {
      setMoreError(userFacingError(caught, "Unable to load more panels. Try again."));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [filters, hasMore, invalidRange, items.length, listObservationGroups, loading, refreshing]);

  return (
    <Screen>
      <FlatList
        contentContainerStyle={styles.content}
        data={invalidRange ? [] : items}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={(
          <View style={styles.header}>
            <View style={styles.intro}>
              <Text style={styles.title}>Panels</Text>
              <Text style={styles.subtitle}>Find measurement panels and grouped records by type and date.</Text>
            </View>
            <Card>
              <Text style={styles.label}>Type</Text>
              <View style={styles.pickerField}>
                <Picker
                  accessibilityLabel="Panel type"
                  selectedValue={filters.kinds?.[0] ?? ""}
                  style={styles.picker}
                  onValueChange={(value) => setFilters((current) => ({
                    ...current,
                    kinds: value ? [value as ObservationGroupKind] : undefined
                  }))}
                >
                  <Picker.Item label="All types" value="" />
                  {groupKinds.map((kind) => <Picker.Item key={kind} label={observationGroupKindLabel(kind)} value={kind} />)}
                </Picker>
              </View>
              <View style={styles.dateRow}>
                <DateFilter
                  label="From"
                  value={filters.dateFrom}
                  maximumDate={filters.dateTo}
                  onChange={(dateFrom) => setFilters((current) => ({ ...current, dateFrom }))}
                />
                <DateFilter
                  label="To"
                  value={filters.dateTo}
                  minimumDate={filters.dateFrom}
                  onChange={(dateTo) => setFilters((current) => ({ ...current, dateTo }))}
                />
              </View>
              {hasFilters ? <Button secondary onPress={() => setFilters({})}>Clear filters</Button> : null}
            </Card>
            {invalidRange ? <Message title="Check the date range" detail="The From date must be on or before the To date." tone="warning" /> : null}
            {loading && !invalidRange ? <Loading label="Loading panels…" /> : null}
            {error && !loading && !invalidRange ? (
              <View style={styles.messageStack}>
                <Message title="Panels unavailable" detail={error} tone="warning" />
                <Button onPress={() => { void loadFirstPage(); }}>Retry</Button>
              </View>
            ) : null}
            {!loading && !error && !invalidRange && items.length === 0 ? (
              <Message
                title={hasFilters ? "No matching panels" : "No panels yet"}
                detail={hasFilters ? "Try clearing or changing the filters." : "Grouped measurements appear here after you add or sync them."}
              />
            ) : null}
          </View>
        )}
        ListFooterComponent={items.length > 0 ? (
          <View style={styles.footer}>
            {loadingMore ? <Loading label="Loading more panels…" /> : null}
            {moreError ? (
              <>
                <Message title="More panels unavailable" detail={moreError} tone="warning" />
                <Button secondary onPress={() => { void loadMore(); }}>Retry</Button>
              </>
            ) : null}
          </View>
        ) : null}
        onEndReached={() => { void loadMore(); }}
        onEndReachedThreshold={0.35}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void loadFirstPage(true); }} />}
        renderItem={({ item }) => (
          <Pressable
            accessibilityHint="Opens this measurement group"
            accessibilityLabel={`${item.label}, ${observationGroupKindLabel(item.kind)}, ${formatPanelDate(item.date)}`}
            accessibilityRole="button"
            onPress={() => navigation.navigate("ObservationGroup", { groupId: item.id, label: item.label })}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Card>
              <View style={styles.panelRow}>
                <View style={styles.panelCopy}>
                  <Text numberOfLines={2} style={styles.panelLabel}>{item.label}</Text>
                  <Text style={styles.panelType}>{observationGroupKindLabel(item.kind)}</Text>
                  <View style={styles.panelMeta}>
                    <Text style={styles.meta}>{formatPanelDate(item.date)}</Text>
                    <Text style={styles.meta}>{item.measurementCount} {item.measurementCount === 1 ? "measurement" : "measurements"}</Text>
                  </View>
                </View>
                <ChevronRight color={colors.primary} size={22} />
              </View>
            </Card>
          </Pressable>
        )}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}

function DateFilter({
  label,
  value,
  minimumDate,
  maximumDate,
  onChange
}: {
  label: string;
  value?: string;
  minimumDate?: string;
  maximumDate?: string;
  onChange: (value: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.dateFilter}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityHint={`Opens the ${label.toLowerCase()} date picker`}
        accessibilityLabel={`${label} date: ${value ? formatPanelDate(value) : "Any date"}`}
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.dateButton, pressed && styles.pressed]}
      >
        <Text style={value ? styles.dateValue : styles.datePlaceholder}>{value ? formatPanelDate(value) : "Any date"}</Text>
        <CalendarDays color={colors.primary} size={19} />
      </Pressable>
      {value ? (
        <Pressable accessibilityRole="button" onPress={() => onChange(undefined)} style={styles.clearDate}>
          <Text style={styles.clearDateText}>Clear {label.toLowerCase()}</Text>
        </Pressable>
      ) : null}
      {open ? (
        <View style={styles.datePicker}>
          <DateTimePicker
            maximumDate={maximumDate ? dateFromValue(maximumDate) : undefined}
            minimumDate={minimumDate ? dateFromValue(minimumDate) : undefined}
            mode="date"
            value={value ? dateFromValue(value) : new Date()}
            onChange={(_event, date) => {
              if (date) onChange(dateToValue(date));
              if (Platform.OS !== "ios") setOpen(false);
            }}
          />
          {Platform.OS === "ios" ? <Button secondary onPress={() => setOpen(false)}>Done</Button> : null}
        </View>
      ) : null}
    </View>
  );
}

function dateFromValue(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

function dateToValue(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatPanelDate(value: string | undefined): string {
  if (!value) return "Date unavailable";
  const date = dateFromValue(value.slice(0, 10));
  return Number.isNaN(date.getTime())
    ? value.slice(0, 10)
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingBottom: spacing.xl },
  header: { gap: spacing.md, marginBottom: spacing.sm },
  intro: { gap: spacing.xs },
  title: { color: colors.text, fontSize: type.heading, fontWeight: "800" },
  subtitle: { color: colors.muted, fontSize: type.body, lineHeight: 22 },
  label: { color: colors.muted, fontSize: type.label, fontWeight: "700" },
  pickerField: { borderColor: colors.border, borderRadius: radii.sm, borderWidth: 1, overflow: "hidden" },
  picker: { color: colors.text, minHeight: 48 },
  dateRow: { flexDirection: "row", gap: spacing.sm },
  dateFilter: { flex: 1, gap: spacing.xs, minWidth: 0 },
  dateButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: spacing.sm
  },
  dateValue: { color: colors.text, flex: 1, fontSize: type.label },
  datePlaceholder: { color: colors.muted, flex: 1, fontSize: type.label },
  datePicker: { gap: spacing.sm },
  clearDate: { alignSelf: "flex-start", minHeight: 32, justifyContent: "center" },
  clearDateText: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  messageStack: { gap: spacing.sm },
  panelRow: { alignItems: "center", flexDirection: "row", gap: spacing.md },
  panelCopy: { flex: 1, gap: spacing.xs, minWidth: 0 },
  panelLabel: { color: colors.textStrong, fontSize: type.title, fontWeight: "800" },
  panelType: { color: colors.muted, fontSize: type.label },
  panelMeta: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  meta: { color: colors.muted, fontSize: 13 },
  footer: { gap: spacing.sm, paddingTop: spacing.sm },
  pressed: { opacity: 0.78 }
});
