import { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { useKeepAwake } from "expo-keep-awake";
import {
  defaultMeasurementTypes,
  filterManualGroupTemplates,
  findKnownMeasurement,
  getPreferredUnit,
  manualGroupDefaults,
  type BodyCompositionDraft,
  type BodyCompositionDraftRow,
  type ManualObservationPayload
} from "@local-fitness-advisor/shared";
import { createCompanionApi } from "../api";
import {
  HEALTH_CONNECT_CATEGORIES,
  HEALTH_CONNECT_SYNC_WINDOW_OPTIONS,
  saveConnection,
  updateHealthConnectSyncCursor,
  type HealthConnectCategory
} from "../endpointStore";
import { useMobileApi } from "../MobileApiProvider";
import { syncHealthConnect } from "../syncHealthConnect";
import { Button, Card, Message, Screen } from "../ui/components";
import { colors, spacing } from "../ui/theme";

const privacyUrl = "https://github.com/benleane83/local-fitness-advisor/blob/main/docs/PRIVACY_POLICY.md";
type Segment = "Scan" | "Manual" | "Health Connect";
type ScanKind = "body-composition" | "blood-test";

export function ImportScreen() {
  const [segment, setSegment] = useState<Segment>("Scan");
  return (
    <Screen>
      <View style={styles.segmented}>
        {(["Scan", "Manual", "Health Connect"] as const).map((value) => (
          <Pressable key={value} onPress={() => setSegment(value)} style={[styles.segment, segment === value && styles.segmentSelected]}>
            <Text style={[styles.segmentText, segment === value && styles.segmentTextSelected]}>{value}</Text>
          </Pressable>
        ))}
      </View>
      {segment === "Scan" ? <ScanImport /> : segment === "Manual" ? <ManualImport /> : <HealthConnectImport />}
    </Screen>
  );
}

function ManualImport() {
  const { bootstrap, connection, refreshAfterImport } = useMobileApi();
  const measurements = bootstrap?.measurementTypes?.length ? bootstrap.measurementTypes : defaultMeasurementTypes;
  const templates = filterManualGroupTemplates(bootstrap?.manualObservationGroupTemplates ?? []);
  const groups = [...manualGroupDefaults.map((group) => group.label), ...templates.map((template) => template.label)];
  const [group, setGroup] = useState("Activity");
  const [date, setDate] = useState(new Date());
  const [rows, setRows] = useState([{ id: "first", measurement: "steps", value: "", unit: "count" }]);
  const [status, setStatus] = useState("");
  const client = useMemo(() => connection?.token ? createCompanionApi(connection) : undefined, [connection]);

  function selectGroup(nextGroup: string) {
    setGroup(nextGroup);
    const defaultGroup = manualGroupDefaults.find((entry) => entry.label === nextGroup);
    const template = templates.find((entry) => entry.label === nextGroup);
    const nextRows = defaultGroup
      ? [{ id: `${Date.now()}`, measurement: defaultGroup.measurementCode, value: "", unit: getPreferredUnit(
          measurements.find((entry) => entry.code === defaultGroup.measurementCode)!,
          bootstrap?.profile.units ?? "metric"
        ) }]
      : template?.measurements.map((entry, index) => ({
          id: `${Date.now()}-${index}`,
          measurement: entry.measurementCode,
          value: "",
          unit: entry.unit
        })) ?? [];
    setRows(nextRows.length ? nextRows : [{ id: `${Date.now()}`, measurement: "", value: "", unit: "" }]);
  }

  async function submit() {
    if (!client) return;
    try {
      const observations = rows.map((row) => {
        const measurement = findKnownMeasurement(row.measurement, measurements);
        const value = Number(row.value);
        if (!measurement || !Number.isFinite(value)) throw new Error("Choose a known measurement and enter a numeric value.");
        return { measurementCode: measurement.code, measurementName: measurement.display, value, unit: row.unit || measurement.canonicalUnit };
      });
      const payload: ManualObservationPayload = {
        observedAt: date.toISOString(),
        label: group,
        observations
      };
      await client.importManualObservations(payload);
      setStatus("Manual observations imported.");
      selectGroup(group);
      await refreshAfterImport();
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Import failed.");
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.chips}>
        {groups.map((value) => <Chip key={value} label={value} selected={group === value} onPress={() => selectGroup(value)} />)}
      </View>
      <Card>
        <Text style={styles.label}>Observed date</Text>
        <DateTimePicker value={date} mode="date" onChange={(_event, value) => value && setDate(value)} />
      </Card>
      {rows.map((row) => (
        <Card key={row.id}>
          <TextInput
            accessibilityLabel="Measurement"
            placeholder="Search measurement"
            style={styles.input}
            value={row.measurement}
            onChangeText={(measurement) => setRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, measurement } : entry))}
          />
          <View style={styles.row}>
            <TextInput
              accessibilityLabel="Value"
              keyboardType="decimal-pad"
              placeholder="Value"
              style={[styles.input, styles.flex]}
              value={row.value}
              onChangeText={(value) => setRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, value } : entry))}
            />
            <TextInput
              accessibilityLabel="Unit"
              placeholder="Unit"
              style={[styles.input, styles.flex]}
              value={row.unit}
              onChangeText={(unit) => setRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, unit } : entry))}
            />
          </View>
          {rows.length > 1 ? <Button secondary onPress={() => setRows((current) => current.filter((entry) => entry.id !== row.id))}>Remove row</Button> : null}
        </Card>
      ))}
      <Button secondary onPress={() => setRows((current) => [...current, { id: `${Date.now()}`, measurement: "", value: "", unit: "" }])}>Add row</Button>
      <Button onPress={() => { void submit(); }}>Import observations</Button>
      {status ? <Message title={status} /> : null}
    </ScrollView>
  );
}

function ScanImport() {
  const { connection, refreshAfterImport, transientRevision } = useMobileApi();
  const [kind, setKind] = useState<ScanKind>("body-composition");
  const [draft, setDraft] = useState<BodyCompositionDraft>();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  useKeepAwake(busy ? "report-scan" : undefined);
  const client = useMemo(() => connection?.token ? createCompanionApi(connection) : undefined, [connection]);
  useEffect(() => {
    setDraft(undefined);
    setStatus("");
  }, [connection, transientRevision]);

  async function acquire(camera: boolean) {
    if (!client) return;
    setBusy(true);
    setStatus("Preparing report for PC-side OCR…");
    try {
      const result = camera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
      const asset = result.assets?.[0];
      if (result.canceled || !asset) return;
      const resized = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: Math.min(asset.width || 1800, 1800) } }],
        { base64: true, compress: 0.72, format: ImageManipulator.SaveFormat.JPEG }
      );
      if (!resized.base64) throw new Error("Could not read the selected image.");
      const next = kind === "body-composition"
        ? await client.previewBodyCompositionReport({ fileName: asset.fileName ?? "report.jpg", mimeType: "image/jpeg", contentBase64: resized.base64 })
        : await client.previewBloodTestReport({ fileName: asset.fileName ?? "report.jpg", mimeType: "image/jpeg", contentBase64: resized.base64 });
      setDraft(next);
      setStatus("Review OCR results before importing.");
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Report preview failed.");
    } finally {
      setBusy(false);
    }
  }

  function patchRow(id: string, patch: Partial<BodyCompositionDraftRow>) {
    setDraft((current) => current ? {
      ...current,
      rows: current.rows.map((row) => row.id === id ? { ...row, ...patch } : row)
    } : current);
  }

  async function commit() {
    if (!client || !draft) return;
    const rows = draft.rows.filter((row) => row.included);
    if (!rows.length) {
      setStatus("Include at least one row.");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        fileName: draft.fileName,
        reportDate: draft.reportDate,
        sourceText: draft.sourceText,
        sourceChecksum: draft.checksum,
        rows
      };
      if (kind === "body-composition") await client.commitBodyCompositionReport(payload);
      else await client.commitBloodTestReport(payload);
      setDraft(undefined);
      setStatus("Approved report rows imported.");
      await refreshAfterImport();
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Report import failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.chips}>
        <Chip label="Body composition" selected={kind === "body-composition"} onPress={() => { setKind("body-composition"); setDraft(undefined); }} />
        <Chip label="Blood test" selected={kind === "blood-test"} onPress={() => { setKind("blood-test"); setDraft(undefined); }} />
      </View>
      {!draft ? (
        <Card>
          <Text style={styles.body}>Images travel only over your pinned local connection for OCR on the PC. Nothing is committed until you approve the rows.</Text>
          <Button disabled={busy} onPress={() => { void acquire(true); }}>Take photo</Button>
          <Button disabled={busy} secondary onPress={() => { void acquire(false); }}>Choose from gallery</Button>
        </Card>
      ) : draft.rows.map((row) => (
        <Card key={row.id}>
          <View style={styles.row}><Text style={styles.heading}>{row.label}</Text><Switch value={row.included} onValueChange={(included) => patchRow(row.id, { included })} /></View>
          <Text style={styles.meta}>OCR confidence: {row.confidence}</Text>
          <TextInput style={styles.input} value={row.measurementCode} onChangeText={(measurementCode) => patchRow(row.id, { measurementCode })} />
          <View style={styles.row}>
            <TextInput style={[styles.input, styles.flex]} keyboardType="decimal-pad" value={String(row.value)} onChangeText={(value) => patchRow(row.id, { value: Number(value) })} />
            <TextInput style={[styles.input, styles.flex]} value={row.unit} onChangeText={(unit) => patchRow(row.id, { unit })} />
          </View>
        </Card>
      ))}
      {draft ? <><Button disabled={busy} onPress={() => { void commit(); }}>Import approved rows</Button><Button secondary onPress={() => setDraft(undefined)}>Cancel review</Button></> : null}
      {status ? <Message title={status} /> : null}
    </ScrollView>
  );
}

function HealthConnectImport() {
  const { bootstrap, connection, refreshAfterImport, reloadConnection } = useMobileApi();
  const [status, setStatus] = useState("");
  const [syncing, setSyncing] = useState(false);
  useKeepAwake(syncing ? "health-connect-sync" : undefined);
  if (!connection) return <Message title="Pair with your PC before syncing." />;
  const currentConnection = connection;

  async function update(patch: Partial<typeof currentConnection>) {
    await saveConnection({ ...currentConnection, ...patch });
    await reloadConnection();
  }

  async function sync() {
    setSyncing(true);
    try {
      const result = await syncHealthConnect(
        currentConnection.url,
        currentConnection.token,
        bootstrap?.profile.id ?? null,
        currentConnection.publicKeyHash,
        {
          deviceId: currentConnection.deviceId,
          syncCursor: currentConnection.healthConnectSyncCursor,
          syncWindowDays: currentConnection.healthConnectSyncWindowDays,
          categories: currentConnection.healthConnectCategories
        }
      );
      if (result.canAdvanceCursor) await updateHealthConnectSyncCursor(currentConnection.url, result.syncCursor);
      setStatus(`${result.status} ${result.details}`);
      await reloadConnection();
      await refreshAfterImport();
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Health Connect sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card>
        <Text style={styles.heading}>Health data to sync</Text>
        <View style={styles.chips}>
          {HEALTH_CONNECT_CATEGORIES.map((category) => (
            <Chip
              key={category}
              label={category}
              selected={currentConnection.healthConnectCategories.includes(category)}
              onPress={() => {
                const categories: HealthConnectCategory[] = currentConnection.healthConnectCategories.includes(category)
                  ? currentConnection.healthConnectCategories.filter((entry) => entry !== category)
                  : [...currentConnection.healthConnectCategories, category];
                void update({ healthConnectCategories: categories });
              }}
            />
          ))}
        </View>
        <Text style={styles.heading}>Initial sync window</Text>
        <View style={styles.chips}>
          {HEALTH_CONNECT_SYNC_WINDOW_OPTIONS.map((days) => <Chip key={days} label={`${days} days`} selected={currentConnection.healthConnectSyncWindowDays === days} onPress={() => { void update({ healthConnectSyncWindowDays: days }); }} />)}
        </View>
      </Card>
      {!currentConnection.healthConnectDisclosureAcknowledged ? (
        <Card>
          <Text style={styles.body}>Selected Health Connect records are sent read-only to your paired PC over the pinned local connection. They are not sold or used for advertising.</Text>
          <Button secondary onPress={() => { void Linking.openURL(privacyUrl); }}>Privacy policy</Button>
          <Button onPress={() => { void update({ healthConnectDisclosureAcknowledged: true }); }}>I understand and continue</Button>
        </Card>
      ) : <Button secondary onPress={() => { void Linking.openURL(privacyUrl); }}>Privacy policy</Button>}
      <Button disabled={syncing || !currentConnection.healthConnectDisclosureAcknowledged} onPress={() => { void sync(); }}>{syncing ? "Syncing…" : "Sync now"}</Button>
      {status ? <Message title={status} /> : null}
    </ScrollView>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  segmented: { backgroundColor: colors.border, borderRadius: 10, flexDirection: "row", marginBottom: spacing.md, padding: 2 },
  segment: { alignItems: "center", borderRadius: 8, flex: 1, padding: spacing.sm },
  segmentSelected: { backgroundColor: colors.surface },
  segmentText: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  segmentTextSelected: { color: colors.primary },
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 999, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 13 },
  chipTextSelected: { color: "#fff" },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 8, borderWidth: 1, color: colors.text, minHeight: 46, paddingHorizontal: spacing.sm },
  row: { alignItems: "center", flexDirection: "row", gap: spacing.sm, justifyContent: "space-between" },
  flex: { flex: 1 },
  label: { color: colors.muted, fontSize: 12, fontWeight: "700", textTransform: "uppercase" },
  heading: { color: colors.text, fontSize: 16, fontWeight: "700" },
  body: { color: colors.text, fontSize: 14, lineHeight: 20 },
  meta: { color: colors.muted, fontSize: 12 }
});
