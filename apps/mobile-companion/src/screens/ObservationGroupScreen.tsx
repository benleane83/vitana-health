import { useEffect, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ChevronRight } from "lucide-react-native";
import type { ObservationGroupDetail, ReferenceRange } from "@vitana/shared";
import { useMobileApi } from "../MobileApiProvider";
import type { RootStackParamList } from "../navigationTypes";
import { Button, Card, Loading, Message, Screen } from "../ui/components";
import { colors, radii, spacing, type } from "../ui/theme";
import { userFacingError } from "../userFacingError";

type Props = NativeStackScreenProps<RootStackParamList, "ObservationGroup">;
type GroupObservation = ObservationGroupDetail["observations"][number];

export function ObservationGroupScreen({ navigation, route }: Props) {
  const { connectionState, deleteObservationGroup, demoMode, observationGroup, standaloneMode } = useMobileApi();
  const [detail, setDetail] = useState<ObservationGroupDetail>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();

  useEffect(() => {
    let current = true;
    setDetail(undefined);
    setError(undefined);
    setLoading(true);
    void observationGroup(route.params.groupId)
      .then((result) => {
        if (current) setDetail(result);
      })
      .catch((caught: unknown) => {
        if (current) setError(userFacingError(caught, "Unable to load this measurement group. Try again."));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => { current = false; };
  }, [observationGroup, route.params.groupId]);

  if (loading) return <Screen><Loading label="Loading measurement group…" /></Screen>;
  if (!detail) {
    return (
      <Screen>
        <Message title="Measurement group unavailable" detail={error ?? "This group could not be found."} tone="warning" />
      </Screen>
    );
  }

  const selectedGroup = detail;
  const canDeletePanel = demoMode || standaloneMode || connectionState === "online";

  function confirmDeletion() {
    const measurementLabel = selectedGroup.observations.length === 1 ? "measurement" : "measurements";
    Alert.alert(
      "Delete panel?",
      `Delete "${selectedGroup.label}" and all ${selectedGroup.observations.length} ${measurementLabel} inside it? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete panel", style: "destructive", onPress: () => { void deletePanel(); } }
      ]
    );
  }

  async function deletePanel() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(undefined);
    try {
      await deleteObservationGroup(selectedGroup.id);
      navigation.goBack();
    } catch (caught: unknown) {
      setDeleteError(userFacingError(caught, "Unable to delete this panel. Try again."));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Screen>
      <FlatList
        contentContainerStyle={styles.content}
        data={detail.observations}
        keyExtractor={(entry) => entry.id}
        ListHeaderComponent={<GroupHeader detail={detail} />}
        ListFooterComponent={canDeletePanel ? (
          <View style={styles.footer}>
            {deleteError ? <Message title="Could not delete panel" detail={deleteError} tone="danger" /> : null}
            <Button
              accessibilityLabel={`Delete ${detail.label} and all contained measurements`}
              danger
              disabled={deleting}
              onPress={confirmDeletion}
            >
              {deleting ? "Deleting…" : "Delete panel"}
            </Button>
          </View>
        ) : null}
        ListEmptyComponent={<Message title="No measurements" detail="This group does not contain any measurements." />}
        renderItem={({ item }) => (
          <ObservationRow
            entry={item}
            onPress={() => navigation.push("TrackDetail", {
              measurementCode: item.measurementCode,
              displayName: item.displayName
            })}
          />
        )}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}

function GroupHeader({ detail }: { detail: ObservationGroupDetail }) {
  return (
    <View style={styles.header}>
      <View style={styles.intro}>
        <Text style={styles.title}>{detail.label}</Text>
        <Text style={styles.subtitle}>
          {humanizeKind(detail.kind)} · {detail.observations.length} {detail.observations.length === 1 ? "measurement" : "measurements"}
        </Text>
      </View>
      <Card>
        <MetadataRow label="Recorded" value={formatTimestamp(detail.collectedAt ?? detail.observations[0]?.observedAt)} />
        <MetadataRow label="Source" value={detail.source.label} />
        {detail.source.importedAt ? <MetadataRow label="Imported" value={formatTimestamp(detail.source.importedAt)} /> : null}
        {detail.source.importFileName ? <MetadataRow label="File" value={detail.source.importFileName} /> : null}
      </Card>
      <Text style={styles.sectionTitle}>Measurements</Text>
    </View>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metadataRow}>
      <Text style={styles.metadataLabel}>{label}</Text>
      <Text style={styles.metadataValue}>{value}</Text>
    </View>
  );
}

function ObservationRow({ entry, onPress }: { entry: GroupObservation; onPress: () => void }) {
  return (
    <Pressable
      accessibilityHint="Opens this measurement's history."
      accessibilityLabel={`${entry.displayName}, ${formatValue(entry.value)} ${entry.unit}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <Card>
        <View style={styles.observationHeader}>
          <View style={styles.observationHeading}>
            <Text style={styles.measurementName}>{entry.displayName}</Text>
            <Text style={styles.value}>{formatValue(entry.value)} <Text style={styles.unit}>{entry.unit}</Text></Text>
          </View>
          <ChevronRight color={colors.primary} size={22} />
        </View>
        {entry.status && entry.status !== "unknown" ? <Status status={entry.status} /> : null}
        {entry.referenceRange ? (
          <Text style={styles.meta}>Reference range: {formatReferenceRange(entry.referenceRange)}</Text>
        ) : null}
        {entry.note ? <Text style={styles.note}>{entry.note}</Text> : null}
      </Card>
    </Pressable>
  );
}

function Status({ status }: { status: Exclude<GroupObservation["status"], undefined | "unknown"> }) {
  const palette = status === "normal"
    ? { container: styles.statusNormal, text: styles.statusNormalText }
    : { container: styles.statusOutside, text: styles.statusOutsideText };
  return (
    <View style={[styles.status, palette.container]}>
      <Text style={[styles.statusText, palette.text]}>{status}</Text>
    </View>
  );
}

function humanizeKind(value: ObservationGroupDetail["kind"]): string {
  return value.split("_").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}

function formatTimestamp(value: string | undefined): string {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatValue(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function formatReferenceRange(range: ReferenceRange): string {
  if (range.low !== undefined && range.high !== undefined) return `${formatValue(range.low)}–${formatValue(range.high)} ${range.unit}`;
  if (range.low !== undefined) return `At least ${formatValue(range.low)} ${range.unit}`;
  if (range.high !== undefined) return `Up to ${formatValue(range.high)} ${range.unit}`;
  return range.label ?? `Reference range (${range.unit})`;
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingBottom: spacing.xl },
  footer: { gap: spacing.sm, marginTop: spacing.md },
  header: { gap: spacing.md, marginBottom: spacing.xs },
  intro: { gap: spacing.xs },
  title: { color: colors.textStrong, fontSize: type.display, fontWeight: "800" },
  subtitle: { color: colors.muted, fontSize: type.body, lineHeight: 21 },
  sectionTitle: { color: colors.textStrong, fontSize: type.heading, fontWeight: "800", marginTop: spacing.xs },
  metadataRow: { alignItems: "flex-start", flexDirection: "row", gap: spacing.md, justifyContent: "space-between" },
  metadataLabel: { color: colors.muted, fontSize: type.label, fontWeight: "700" },
  metadataValue: { color: colors.text, flex: 1, fontSize: type.body, textAlign: "right" },
  observationHeader: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  observationHeading: { flex: 1, gap: spacing.xs, minWidth: 0 },
  measurementName: { color: colors.textStrong, fontSize: type.title, fontWeight: "800" },
  value: { color: colors.text, fontSize: type.title, fontWeight: "700" },
  unit: { color: colors.muted, fontSize: type.body, fontWeight: "600" },
  meta: { color: colors.muted, fontSize: type.label, lineHeight: 19 },
  note: { color: colors.text, fontSize: type.body, lineHeight: 21 },
  pressed: { opacity: 0.76 },
  status: { alignSelf: "flex-start", borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  statusText: { fontSize: type.label, fontWeight: "700", textTransform: "capitalize" },
  statusNormal: { backgroundColor: colors.successMuted },
  statusNormalText: { color: colors.success },
  statusOutside: { backgroundColor: colors.dangerMuted },
  statusOutsideText: { color: colors.danger }
});
