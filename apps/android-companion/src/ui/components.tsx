import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, controlHeight, radii, spacing, type } from "./theme";

export function Screen({ children }: { children: ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function Button({
  children,
  onPress,
  disabled = false,
  secondary = false
}: {
  children: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondary,
        pressed && styles.pressed,
        disabled && styles.disabled
      ]}
    >
      <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{children}</Text>
    </Pressable>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <View style={styles.center}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>{label}</Text></View>;
}

export function Message({
  title,
  detail,
  tone = "neutral"
}: {
  title: string;
  detail?: string;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
}) {
  return (
    <View style={[styles.message, styles[`${tone}Message`]]}>
      <Text style={styles.heading}>{title}</Text>
      {detail ? <Text style={styles.muted}>{detail}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    justifyContent: "center",
    minHeight: controlHeight,
    paddingHorizontal: spacing.md
  },
  secondary: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.5 },
  buttonText: { color: colors.onAccent, fontSize: 15, fontWeight: "700" },
  secondaryText: { color: colors.text },
  center: { alignItems: "center", gap: spacing.sm, justifyContent: "center", padding: spacing.xl },
  heading: { color: colors.textStrong, fontSize: type.title, fontWeight: "700" },
  muted: { color: colors.muted, fontSize: type.body, lineHeight: 20 },
  message: { borderRadius: radii.md, gap: spacing.xs, padding: spacing.md },
  neutralMessage: { backgroundColor: colors.surfaceMuted },
  infoMessage: { backgroundColor: colors.infoMuted },
  successMessage: { backgroundColor: colors.successMuted },
  warningMessage: { backgroundColor: colors.warningMuted },
  dangerMessage: { backgroundColor: colors.dangerMuted }
});
