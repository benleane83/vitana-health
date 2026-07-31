import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { filterAndSortSummary, type SummarySort } from "@vitana/shared";
import { useMobileApi } from "../MobileApiProvider";
import { connectionStateLabel } from "../connectionState";
import type { RootStackParamList } from "../navigationTypes";
import { Button, Card, Loading, Message, Screen } from "../ui/components";
import { colors, spacing } from "../ui/theme";

export function TrackScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { connectionState, summary, trackLoading, error, refreshTrack } = useMobileApi();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SummarySort>("recency");
  const visible = useMemo(
    () => summary ? filterAndSortSummary(summary, search, sort) : undefined,
    [search, sort, summary]
  );

  if (trackLoading && !visible) return <Screen><Loading label="Loading Track…" /></Screen>;
  if (!visible) return (
    <Screen>
      <Message title="Track unavailable" detail={error ?? "Reconnect to your paired PC and try again."} tone="warning" />
      <Button disabled={trackLoading} onPress={() => { void refreshTrack({ synchronize: true }); }}>{trackLoading ? "Retrying…" : "Retry"}</Button>
    </Screen>
  );

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={trackLoading} onRefresh={() => { void refreshTrack({ synchronize: true }); }} />}
      >
        {connectionState !== "online" ? (
          <Message title={connectionStateLabel(connectionState)} detail={error ?? "Reconnect to refresh Track data."} />
        ) : null}
        <TextInput
          accessibilityLabel="Search metrics"
          onChangeText={setSearch}
          placeholder="Search metrics"
          maxLength={100}
          style={styles.input}
          value={search}
        />
        <View style={styles.sorts}>
          {(["recency", "count", "name"] as const).map((value) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: sort === value }}
              key={value}
              onPress={() => setSort(value)}
              style={[styles.chip, sort === value && styles.chipSelected]}
            >
              <Text style={[styles.chipText, sort === value && styles.chipTextSelected]}>{value}</Text>
            </Pressable>
          ))}
        </View>
        {visible.categories.length === 0 ? <Message title="No matching metrics" /> : null}
        {visible.categories.map((category) => (
          <View key={category.key} style={styles.category}>
            <Text style={styles.heading}>{category.label}</Text>
            {category.rows.map((row) => (
              <Pressable
                accessibilityRole="button"
                key={row.code}
                onPress={() => navigation.navigate("TrackDetail", {
                  measurementCode: row.code,
                  displayName: row.displayName
                })}
              >
                <Card>
                  <View style={styles.row}>
                    <View style={styles.rowText}>
                      <Text numberOfLines={2} style={styles.name}>{row.displayName}</Text>
                      <Text style={styles.meta}>{new Intl.NumberFormat().format(row.counts.total)} {row.counts.total === 1 ? "record" : "records"}</Text>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </View>
                </Card>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.text,
    minHeight: 48,
    paddingHorizontal: spacing.md
  },
  sorts: { flexDirection: "row", gap: spacing.sm },
  chip: { backgroundColor: colors.surface, borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chipSelected: { backgroundColor: colors.primary },
  chipText: { color: colors.text, textTransform: "capitalize" },
  chipTextSelected: { color: "#fff" },
  category: { gap: spacing.sm },
  heading: { color: colors.text, fontSize: 18, fontWeight: "800" },
  row: { alignItems: "center", flexDirection: "row", gap: spacing.sm, justifyContent: "space-between" },
  rowText: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 16, fontWeight: "700" },
  meta: { color: colors.muted, fontSize: 14, lineHeight: 18 },
  chevron: { color: colors.primary, fontSize: 28 }
});
