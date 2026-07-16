import { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { filterAndSortSummary, type SummarySort } from "@local-fitness-advisor/shared";
import { useMobileApi } from "../MobileApiProvider";
import type { RootStackParamList } from "../navigationTypes";
import { Card, Loading, Message, Screen } from "../ui/components";
import { colors, spacing } from "../ui/theme";

export function TrackScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { summary, trackLoading, error, refreshTrack } = useMobileApi();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SummarySort>("recency");
  useFocusEffect(useCallback(() => { void refreshTrack(); }, [refreshTrack]));
  const visible = useMemo(
    () => summary ? filterAndSortSummary(summary, search, sort) : undefined,
    [search, sort, summary]
  );

  if (trackLoading && !visible) return <Screen><Loading label="Loading Track…" /></Screen>;
  if (!visible) return <Screen><Message title="Track unavailable" detail={error} /></Screen>;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={trackLoading} onRefresh={() => { void refreshTrack(); }} />}
      >
        <TextInput
          accessibilityLabel="Search metrics"
          onChangeText={setSearch}
          placeholder="Search metrics"
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
                    <View>
                      <Text style={styles.name}>{row.displayName}</Text>
                      <Text style={styles.meta}>{row.counts.total} record(s)</Text>
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
  row: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  name: { color: colors.text, fontSize: 16, fontWeight: "700" },
  meta: { color: colors.muted, fontSize: 13 },
  chevron: { color: colors.primary, fontSize: 28 }
});
