import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, controlHeight, spacing } from "./theme";

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
      style={[styles.button, secondary && styles.secondary, disabled && styles.disabled]}
    >
      <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{children}</Text>
    </Pressable>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <View style={styles.center}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>{label}</Text></View>;
}

export function Message({ title, detail }: { title: string; detail?: string }) {
  return <Card><Text style={styles.heading}>{title}</Text>{detail ? <Text style={styles.muted}>{detail}</Text> : null}</Card>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 10,
    justifyContent: "center",
    minHeight: controlHeight,
    paddingHorizontal: spacing.md
  },
  secondary: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  disabled: { opacity: 0.5 },
  buttonText: { color: "#ffffff", fontSize: 15, fontWeight: "700" },
  secondaryText: { color: colors.text },
  center: { alignItems: "center", gap: spacing.sm, justifyContent: "center", padding: spacing.xl },
  heading: { color: colors.text, fontSize: 17, fontWeight: "700" },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 }
});
