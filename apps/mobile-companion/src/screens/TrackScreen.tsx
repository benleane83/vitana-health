import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Activity, BookOpenText, CalendarDays, ChartNoAxesCombined, ChevronRight } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigationTypes";
import { Screen } from "../ui/components";
import { colors, radii, spacing, type } from "../ui/theme";

const trackDestinations = [
  {
    description: "Browse every measurement and view its history.",
    icon: Activity,
    label: "Measurements",
    route: "TrackMetrics" as const
  },
  {
    description: "Your activity, sleep, and health events, day by day.",
    icon: BookOpenText,
    label: "Journal",
    route: "TrackJournal" as const
  },
  {
    description: "See measurements and events across each month.",
    icon: CalendarDays,
    label: "Calendar",
    route: "TrackCalendar" as const
  },
  {
    description: "See how your body composition changes over time.",
    icon: ChartNoAxesCombined,
    label: "Body Trend",
    route: "TrackBodyTrend" as const
  }
] as const;

export function TrackScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.intro}>
          <Text style={styles.title}>Review your health data</Text>
          <Text style={styles.subtitle}>Choose a view based on what you want to understand.</Text>
        </View>
        <View style={styles.destinationList}>
          {trackDestinations.map((destination, index) => {
            const Icon = destination.icon;
            return (
              <Pressable
                accessibilityLabel={destination.label}
                accessibilityRole="button"
                key={destination.label}
                onPress={() => navigation.navigate(destination.route)}
                style={({ pressed }) => [
                  styles.destination,
                  index > 0 && styles.destinationDivider,
                  pressed && styles.destinationPressed
                ]}
              >
                <View style={styles.iconBox}>
                  <Icon color={colors.primary} size={22} strokeWidth={2} />
                </View>
                <View style={styles.destinationText}>
                  <View style={styles.destinationHeading}>
                    <Text style={styles.destinationLabel}>{destination.label}</Text>
                  </View>
                  <Text style={styles.destinationDescription}>{destination.description}</Text>
                </View>
                <ChevronRight color={colors.primary} size={22} />
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingBottom: spacing.xl },
  intro: { gap: spacing.xs },
  title: { color: colors.text, fontSize: type.heading, fontWeight: "800" },
  subtitle: { color: colors.muted, fontSize: type.body, lineHeight: 22 },
  destinationList: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    overflow: "hidden"
  },
  destination: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 88,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md
  },
  destinationDivider: { borderTopColor: colors.border, borderTopWidth: 1 },
  destinationPressed: { backgroundColor: colors.surfaceMuted },
  iconBox: {
    alignItems: "center",
    backgroundColor: colors.primaryMuted,
    borderRadius: radii.md,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  destinationText: { flex: 1, gap: spacing.xs, minWidth: 0 },
  destinationHeading: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  destinationLabel: { color: colors.text, fontSize: type.title, fontWeight: "800" },
  destinationDescription: { color: colors.muted, fontSize: type.label, lineHeight: 19 },
});
