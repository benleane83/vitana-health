import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { useKeepAwake } from "expo-keep-awake";
import { ArrowLeft, CalendarDays, ChevronDown, ChevronRight, ChevronUp, LockKeyhole, PencilLine, RefreshCw, ScanLine } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Picker } from "@react-native-picker/picker";
import {
  defaultMeasurementTypes,
  filterManualGroupTemplates,
  findKnownMeasurement,
  getPreferredUnit,
  manualGroupDefaults,
  normalizeGroupLabel,
  type BodyCompositionDraft,
  type ManualObservationPayload
} from "@vitana/shared";
import { createCompanionApi } from "../api";
import { useEntitlement } from "../EntitlementProvider";
import {
  HEALTH_CONNECT_CATEGORIES,
  HEALTH_CONNECT_SYNC_WINDOW_OPTIONS,
  saveConnection,
  updateHealthConnectSyncCursor,
  type HealthConnectCategory
} from "../endpointStore";
import { useMobileApi } from "../MobileApiProvider";
import type { RootStackParamList, TabParamList } from "../navigationTypes";
import { syncHealthConnect } from "../syncHealthConnect";
import { LONG_RUNNING_PINNED_REQUEST_TIMEOUT_MS } from "../pinnedFetch";
import { userFacingError } from "../userFacingError";
import { Button, Card, Message, Screen } from "../ui/components";
import { colors, radii, spacing, type } from "../ui/theme";
import {
  dateOnlyToLocalDate,
  groupScanRows,
  localDateOnly,
  scanReportDate,
  toCommittedScanRows,
  toEditableScanRows,
  type ScanReportEditableRow
} from "./scanReportReview";

const privacyUrl = "https://vitanahealth.app/privacy";
type ImportSource = "sync" | "scan" | "manual";
type ScanKind = "body-composition" | "blood-test";

export function ImportScreen() {
  const { connectionState, demoMode, standaloneMode } = useMobileApi();
  const entitlement = useEntitlement();
  const navigation = useNavigation<BottomTabNavigationProp<TabParamList, "Import">>();
  const [source, setSource] = useState<ImportSource>();
  const connectedOffline = !standaloneMode && connectionState !== "online";
  useEffect(() => {
    if (demoMode || connectedOffline || (standaloneMode && source !== "manual")) setSource(undefined);
  }, [connectedOffline, demoMode, source, standaloneMode]);

  if (!source || demoMode) return <ImportSourceChooser connectedOffline={connectedOffline} demoMode={demoMode} standaloneMode={standaloneMode} unlocked={entitlement.state.status === "owned"} onSelect={setSource} onConnect={() => {
    navigation.getParent<NativeStackNavigationProp<RootStackParamList>>()?.navigate("Connection");
  }} />;

  const sourceTitle = source === "sync" ? "Sync" : source === "scan" ? "Scan a report" : "Enter manually";
  const locked = source !== "manual" && entitlement.state.status !== "owned";
  return (
    <Screen>
      <View style={styles.flowHeader}>
        <Pressable accessibilityLabel="Back to import sources" accessibilityRole="button" onPress={() => setSource(undefined)} style={styles.backButton}>
          <ArrowLeft color={colors.primary} size={22} />
        </Pressable>
        <View style={styles.flowHeadingText}>
          <Text style={styles.flowTitle}>{sourceTitle}</Text>
          <Text style={styles.flowSubtitle}>Import to the active profile</Text>
        </View>
      </View>
      {locked
        ? <LockedImport
            state={entitlement.state}
            onPurchase={() => { void entitlement.purchase(); }}
            onRestore={() => { void entitlement.restore(); }}
          />
        : source === "scan" ? <ScanImport /> : source === "manual" ? <ManualImport /> : <HealthConnectImport />}
    </Screen>
  );
}

function ImportSourceChooser({
  connectedOffline,
  demoMode,
  standaloneMode,
  unlocked,
  onConnect,
  onSelect
}: {
  connectedOffline: boolean;
  demoMode: boolean;
  standaloneMode: boolean;
  unlocked: boolean;
  onConnect: () => void;
  onSelect: (source: ImportSource) => void;
}) {
  const sources: Array<{
    source: ImportSource;
    title: string;
    detail: string;
    icon: typeof RefreshCw;
    color: string;
    background: string;
  }> = [
    {
      source: "sync",
      title: "Sync",
      detail: Platform.OS === "android"
        ? "Bring in recent health data from this Android device."
        : "Bring in recent health data from your phone.",
      icon: RefreshCw,
      color: colors.info,
      background: colors.infoMuted
    },
    {
      source: "scan",
      title: "Scan a report",
      detail: "Photograph a blood test or body composition report for review.",
      icon: ScanLine,
      color: colors.blush,
      background: colors.blushMuted
    },
    {
      source: "manual",
      title: "Enter manually",
      detail: "Add a single reading or a reusable group of measurements.",
      icon: PencilLine,
      color: colors.primary,
      background: colors.lavenderMuted
    }
  ];

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.sourceContent}>
        <View>
          <Text style={styles.sourceTitle}>Add health data</Text>
          <Text style={styles.sourceIntro}>Choose where the new readings should come from.</Text>
        </View>
        {demoMode ? (
          <Message
            title="Previewing with sample data"
            detail="These options are read only in Demo mode."
            tone="info"
          />
        ) : null}
        {connectedOffline ? (
          <Message
            title="Imports unavailable offline"
            detail="Reconnect to your paired PC to import health data."
            tone="warning"
          />
        ) : null}
        <View style={styles.sourceList}>
          {sources.map(({ source, title, detail, icon: Icon, color, background }) => {
            const locked = source !== "manual" && !unlocked;
            const unavailableInStandalone = standaloneMode && source !== "manual";
            const disabled = demoMode || connectedOffline || unavailableInStandalone;
            const unavailableReason = demoMode ? "in Demo mode" : connectedOffline ? "while offline" : "until this phone is paired";
            return (
              <Pressable
                accessibilityHint={disabled ? `Unavailable ${unavailableReason}` : locked ? "Opens purchase options" : `Opens the ${title} flow`}
                accessibilityRole="button"
                accessibilityState={{ disabled }}
                disabled={disabled}
                key={source}
                onPress={() => onSelect(source)}
                style={({ pressed }) => [styles.sourceRow, pressed && !disabled && styles.sourcePressed, disabled && styles.sourceDisabled]}
              >
                <View style={[styles.sourceIcon, { backgroundColor: background }]}>
                  <Icon color={color} size={23} strokeWidth={2.1} />
                </View>
                <View style={styles.sourceText}>
                  <View style={styles.sourceNameRow}>
                    <Text style={styles.sourceName}>{title}</Text>
                    {source === "sync" && !standaloneMode ? <Text style={styles.recommended}>Recommended</Text> : null}
                    {locked ? <View style={styles.lockedBadge}><LockKeyhole color={colors.muted} size={13} /><Text style={styles.lockedText}>Locked</Text></View> : null}
                  </View>
                  <Text style={styles.sourceDetail}>{detail}</Text>
                  {disabled ? <Text style={styles.demoUnavailable}>Unavailable {unavailableReason}</Text> : null}
                </View>
                {!disabled ? <ChevronRight color={colors.muted} size={20} /> : null}
              </Pressable>
            );
          })}
        </View>
        {demoMode ? <Button onPress={onConnect}>Leave Demo mode</Button> : null}
        <Text style={styles.localNote}>
          {standaloneMode
            ? "Readings are stored only in this phone's encrypted local database."
            : "Data travels only between this phone and your paired PC over your local network."}
        </Text>
      </ScrollView>
    </Screen>
  );
}

function LockedImport({
  state,
  onPurchase,
  onRestore
}: {
  state: ReturnType<typeof useEntitlement>["state"];
  onPurchase: () => void;
  onRestore: () => void;
}) {
  const busy = state.status === "checking" || state.status === "purchasing";
  const tone = state.status === "error" ? "danger" : state.status === "pending" ? "warning" : "info";
  const title = state.status === "pending"
    ? "Purchase pending"
    : state.status === "purchasing" ? "Opening the store…" : "Unlock Scan and Sync";

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card>
        <LockKeyhole color={colors.primary} size={28} />
        <Message
          title={title}
          detail={state.message ?? "Make a one-time purchase to use report scanning and device sync on this phone."}
          tone={tone}
        />
        <Button disabled={busy || state.status === "pending"} onPress={onPurchase}>
          {state.status === "purchasing" ? "Opening…" : "Purchase unlock"}
        </Button>
        <Button disabled={busy} secondary onPress={onRestore}>
          {state.status === "checking" ? "Checking…" : "Restore purchase"}
        </Button>
      </Card>
      <Text style={styles.localNote}>Manual entry remains available without a purchase.</Text>
    </ScrollView>
  );
}

function ManualImport() {
  const { bootstrap, importManualObservations, refreshAfterImport } = useMobileApi();
  const measurements = bootstrap?.measurementTypes?.length ? bootstrap.measurementTypes : defaultMeasurementTypes;
  const templates = filterManualGroupTemplates(bootstrap?.manualObservationGroupTemplates ?? []);
  const groups = [...manualGroupDefaults.map((group) => group.label), ...templates.map((template) => template.label)];
  const [group, setGroup] = useState("Activity");
  const [date, setDate] = useState(new Date());
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [rows, setRows] = useState([{ id: "first", measurement: "steps", value: "", unit: "count" }]);
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"success" | "danger">("success");
  const [busy, setBusy] = useState(false);
  const selectedDefault = manualGroupDefaults.find((entry) => entry.label === group);
  const selectedTemplate = templates.find((entry) => entry.normalizedLabel === normalizeGroupLabel(group));
  const allowedMeasurements = useMemo(() => {
    if (selectedDefault) return measurements.filter((entry) => entry.category === selectedDefault.category);
    if (selectedTemplate) {
      const measurementCodes = new Set(selectedTemplate.measurements.map((entry) => entry.measurementCode));
      return measurements.filter((entry) => measurementCodes.has(entry.code));
    }
    return measurements;
  }, [measurements, selectedDefault, selectedTemplate]);

  function selectGroup(nextGroup: string) {
    setGroup(nextGroup);
    const defaultGroup = manualGroupDefaults.find((entry) => entry.label === nextGroup);
    const template = templates.find((entry) => entry.normalizedLabel === normalizeGroupLabel(nextGroup));
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

  function selectMeasurement(rowId: string, measurementCode: string) {
    const measurement = measurements.find((entry) => entry.code === measurementCode);
    setRows((current) => current.map((entry) => entry.id === rowId
      ? {
          ...entry,
          measurement: measurementCode,
          unit: measurement ? getPreferredUnit(measurement, bootstrap?.profile.units ?? "metric") : entry.unit
        }
      : entry));
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      const observations = rows.map((row) => {
        const measurement = findKnownMeasurement(row.measurement, measurements);
        const value = parseNumericInput(row.value);
        if (!measurement || !Number.isFinite(value)) throw new Error("Choose a known measurement and enter a numeric value.");
        return { measurementCode: measurement.code, measurementName: measurement.display, value, unit: row.unit || measurement.canonicalUnit };
      });
      const payload: ManualObservationPayload = {
        observedAt: date.toISOString(),
        label: group,
        observations
      };
      await importManualObservations(payload);
      setStatusTone("success");
      setStatus(`${observations.length} ${observations.length === 1 ? "reading" : "readings"} imported. View them in Track.`);
      selectGroup(group);
      await refreshAfterImport();
    } catch (caught) {
      setStatusTone("danger");
      setStatus(userFacingError(caught, "Import failed. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.chips}>
        {groups.map((value) => <Chip disabled={busy} key={value} label={value} selected={group === value} onPress={() => selectGroup(value)} />)}
      </View>
      <Card>
        <Pressable
          accessibilityHint="Opens the observed date picker"
          accessibilityLabel={`Observed date: ${formatObservedDate(date)}`}
          accessibilityRole="button"
          disabled={busy}
          onPress={() => setDatePickerOpen(true)}
          style={({ pressed }) => [styles.dateField, pressed && styles.dateFieldPressed, busy && styles.dateFieldDisabled]}
        >
          <View>
            <Text style={styles.label}>Observed date</Text>
            <Text style={styles.dateValue}>{formatObservedDate(date)}</Text>
          </View>
          <CalendarDays color={colors.primary} size={21} />
        </Pressable>
        {datePickerOpen ? (
          <View style={styles.datePicker}>
            <DateTimePicker
              value={date}
              mode="date"
              onChange={(_event, value) => {
                if (value) setDate(value);
                if (Platform.OS !== "ios") setDatePickerOpen(false);
              }}
            />
            {Platform.OS === "ios" ? <Button secondary onPress={() => setDatePickerOpen(false)}>Done</Button> : null}
          </View>
        ) : null}
      </Card>
      {rows.map((row) => (
        <Card key={row.id}>
          <View style={styles.field}>
            <Text style={styles.label}>Measurement</Text>
            <View style={styles.pickerField}>
              <Picker
                accessibilityLabel="Measurement"
                enabled={!busy}
                onValueChange={(measurementCode) => selectMeasurement(row.id, String(measurementCode))}
                selectedValue={row.measurement}
                style={styles.picker}
              >
                <Picker.Item label="Choose a measurement" value="" />
                {allowedMeasurements.map((measurement) => (
                  <Picker.Item key={measurement.code} label={measurement.display} value={measurement.code} />
                ))}
              </Picker>
            </View>
          </View>
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
          {rows.length > 1 ? <Button disabled={busy} secondary onPress={() => setRows((current) => current.filter((entry) => entry.id !== row.id))}>Remove row</Button> : null}
        </Card>
      ))}
      <Button disabled={busy} secondary onPress={() => setRows((current) => [...current, { id: `${Date.now()}`, measurement: "", value: "", unit: "" }])}>Add row</Button>
      <Button disabled={busy} onPress={() => { void submit(); }}>{busy ? "Importing…" : "Import observations"}</Button>
      {status ? <Message title={statusTone === "success" ? "Import complete" : "Could not import readings"} detail={status} tone={statusTone} /> : null}
      {status && statusTone === "success" ? <ViewImportedDataButton /> : null}
    </ScrollView>
  );
}

function ScanImport() {
  const { connection, refreshAfterImport, transientRevision } = useMobileApi();
  const [kind, setKind] = useState<ScanKind>("body-composition");
  const [draft, setDraft] = useState<BodyCompositionDraft>();
  const [rows, setRows] = useState<ScanReportEditableRow[]>([]);
  const [reportDate, setReportDate] = useState("");
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"info" | "success" | "warning" | "danger">("info");
  const [busy, setBusy] = useState(false);
  useKeepAwake(busy ? "report-scan" : undefined);
  const client = useMemo(
    () => connection?.token ? createCompanionApi(connection, LONG_RUNNING_PINNED_REQUEST_TIMEOUT_MS) : undefined,
    [connection]
  );
  useEffect(() => {
    resetReview();
    setStatus("");
  }, [connection, transientRevision]);

  function resetReview() {
    setDraft(undefined);
    setRows([]);
    setReportDate("");
    setDatePickerOpen(false);
  }

  async function acquire(camera: boolean) {
    if (!client) return;
    setBusy(true);
    setStatusTone("info");
    setStatus("Preparing report for PC scanning…");
    try {
      const result = camera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
      const asset = result.assets?.[0];
      if (result.canceled || !asset) {
        setStatus("");
        return;
      }
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
      setRows(toEditableScanRows(next.rows));
      setReportDate(scanReportDate(next.reportDate));
      setStatusTone("warning");
      setStatus("Review OCR results before importing.");
    } catch (caught) {
      setStatusTone("danger");
      setStatus(userFacingError(caught, "Report preview failed. Check the connection to your paired PC and try again."));
    } finally {
      setBusy(false);
    }
  }

  function patchRow(id: string, patch: Partial<ScanReportEditableRow>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  async function commit() {
    if (!client || !draft) return;
    let approvedRows;
    try {
      approvedRows = toCommittedScanRows(rows);
    } catch (caught) {
      setStatusTone("warning");
      setStatus(caught instanceof Error ? caught.message : "Review the selected rows before importing.");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        fileName: draft.fileName,
        reportDate,
        sourceText: draft.sourceText,
        sourceChecksum: draft.checksum,
        rows: approvedRows
      };
      if (kind === "body-composition") await client.commitBodyCompositionReport(payload);
      else await client.commitBloodTestReport(payload);
      resetReview();
      setStatusTone("success");
      setStatus(`${approvedRows.length} approved ${approvedRows.length === 1 ? "row" : "rows"} imported. View them in Track.`);
      await refreshAfterImport();
    } catch (caught) {
      setStatusTone("danger");
      setStatus(userFacingError(caught, "Report import failed. Check the connection to your paired PC and try again."));
    } finally {
      setBusy(false);
    }
  }

  const groupedRows = groupScanRows(rows);

  function renderRow(row: ScanReportEditableRow) {
    return (
      <Card key={row.id}>
        <View style={styles.row}><Text style={[styles.heading, styles.flex]}>{row.label}</Text><Switch accessibilityLabel={`Include ${row.label}`} disabled={busy} value={row.included} onValueChange={(included) => patchRow(row.id, { included })} /></View>
        <Text style={styles.meta}>OCR confidence: {row.confidence}</Text>
        <TextInput accessibilityLabel={`Measurement for ${row.label}`} editable={!busy} style={styles.input} value={row.measurementCode} onChangeText={(measurementCode) => patchRow(row.id, { measurementCode })} />
        <View style={styles.row}>
          <TextInput accessibilityLabel={`Value for ${row.label}`} editable={!busy} style={[styles.input, styles.flex]} keyboardType="decimal-pad" value={row.value} onChangeText={(value) => patchRow(row.id, { value })} />
          <TextInput accessibilityLabel={`Unit for ${row.label}`} editable={!busy} style={[styles.input, styles.flex]} value={row.unit} onChangeText={(unit) => patchRow(row.id, { unit })} />
        </View>
      </Card>
    );
  }

  function renderGroup(title: string, groupRows: ScanReportEditableRow[], emptyMessage: string) {
    return (
      <View accessibilityLabel={`${title}, ${groupRows.length} ${groupRows.length === 1 ? "measurement" : "measurements"}`} style={styles.reviewGroup}>
        <View style={styles.reviewGroupHeading}>
          <Text style={styles.heading}>{title}</Text>
          <Text style={styles.reviewGroupCount}>{groupRows.length}</Text>
        </View>
        {groupRows.length ? groupRows.map(renderRow) : <Text style={styles.reviewGroupEmpty}>{emptyMessage}</Text>}
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.chips}>
        <Chip disabled={busy} label="Body composition" selected={kind === "body-composition"} onPress={() => { setKind("body-composition"); resetReview(); }} />
        <Chip disabled={busy} label="Blood test" selected={kind === "blood-test"} onPress={() => { setKind("blood-test"); resetReview(); }} />
      </View>
      {!draft ? (
        <Card>
          <Text style={styles.body}>Images travel only over your local network for scanning on the PC. Nothing is committed until you approve the rows.</Text>
          <Button disabled={busy} onPress={() => { void acquire(true); }}>Take photo</Button>
          <Button disabled={busy} secondary onPress={() => { void acquire(false); }}>Choose from gallery</Button>
        </Card>
      ) : (
        <>
          <Card>
            <Pressable
              accessibilityHint="Opens the report date picker"
              accessibilityLabel={`Report date: ${formatDateOnly(reportDate)}`}
              accessibilityRole="button"
              disabled={busy}
              onPress={() => setDatePickerOpen(true)}
              style={({ pressed }) => [styles.dateField, pressed && styles.dateFieldPressed, busy && styles.dateFieldDisabled]}
            >
              <View>
                <Text style={styles.label}>Report date</Text>
                <Text style={styles.dateValue}>{formatDateOnly(reportDate)}</Text>
              </View>
              <CalendarDays color={colors.primary} size={21} />
            </Pressable>
            {datePickerOpen ? (
              <View style={styles.datePicker}>
                <DateTimePicker
                  value={dateOnlyToLocalDate(reportDate)}
                  mode="date"
                  onChange={(_event, value) => {
                    if (value) setReportDate(localDateOnly(value));
                    if (Platform.OS !== "ios") setDatePickerOpen(false);
                  }}
                />
                {Platform.OS === "ios" ? <Button secondary onPress={() => setDatePickerOpen(false)}>Done</Button> : null}
              </View>
            ) : null}
          </Card>
          {renderGroup("Selected for save", groupedRows.selected, "Select at least one measurement to save it.")}
          {renderGroup("Not selected", groupedRows.notSelected, "All measurements are selected for save.")}
        </>
      )}
      {draft ? <><Button disabled={busy || groupedRows.selected.length === 0} onPress={() => { void commit(); }}>Import approved rows</Button><Button disabled={busy} secondary onPress={resetReview}>Cancel review</Button></> : null}
      {status ? <Message title={statusTone === "success" ? "Import complete" : statusTone === "danger" ? "Could not import report" : "Report status"} detail={status} tone={statusTone} /> : null}
      {status && statusTone === "success" ? <ViewImportedDataButton /> : null}
    </ScrollView>
  );
}

function HealthConnectImport() {
  const { bootstrap, connection, refreshAfterImport, reloadConnection } = useMobileApi();
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"success" | "danger">("success");
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState("");
  const [updating, setUpdating] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  useKeepAwake(syncing ? "health-connect-sync" : undefined);
  if (!connection) return <Message title="Pair with your PC before syncing." />;
  const currentConnection = connection;

  async function update(patch: Partial<typeof currentConnection>): Promise<boolean> {
    if (updating || syncing) return false;
    setUpdating(true);
    try {
      await saveConnection({ ...currentConnection, ...patch });
      await reloadConnection();
      return true;
    } catch (caught) {
      setStatusTone("danger");
      setStatus(userFacingError(caught, "Could not save Sync settings. Try again."));
      return false;
    } finally {
      setUpdating(false);
    }
  }

  function confirmResetSyncCursor() {
    Alert.alert(
      "Reset sync start date?",
      `The next sync will read the full selected ${currentConnection.healthConnectSyncWindowDays}-day window. Existing imported readings stay in place and duplicates are ignored.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Reset", style: "destructive", onPress: () => { void resetSyncCursor(); } }
      ]
    );
  }

  async function resetSyncCursor() {
    if (await update({ healthConnectSyncCursor: null })) {
      setStatusTone("success");
      setStatus(`Sync start date reset. Your next sync will include the full ${currentConnection.healthConnectSyncWindowDays}-day window.`);
    }
  }

  async function sync() {
    if (syncing || updating) return;
    setSyncing(true);
    setSyncProgress("Checking Health Connect on this phone…");
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
          categories: currentConnection.healthConnectCategories,
          onProgress: ({ detail }) => setSyncProgress(detail)
        }
      );
      if (result.canAdvanceCursor) await updateHealthConnectSyncCursor(currentConnection.url, result.syncCursor);
      setStatusTone("success");
      setStatus(`${result.status} ${result.details}`);
      setSyncProgress("Refreshing your imported readings…");
      await reloadConnection();
      await refreshAfterImport();
    } catch (caught) {
      setStatusTone("danger");
      setStatus(userFacingError(caught, "Sync failed. Check the connection to your paired PC and try again."));
    } finally {
      setSyncing(false);
      setSyncProgress("");
    }
  }

  async function openPrivacyPolicy() {
    try {
      await Linking.openURL(privacyUrl);
    } catch {
      setStatusTone("danger");
      setStatus("Could not open the privacy policy on this device.");
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card>
        <Text style={styles.heading}>Data to sync</Text>
        <View style={styles.chips}>
          {HEALTH_CONNECT_CATEGORIES.map((category) => (
            <Chip
              key={category}
              label={category}
              disabled={updating || syncing}
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
          {HEALTH_CONNECT_SYNC_WINDOW_OPTIONS.map((days) => <Chip disabled={updating || syncing} key={days} label={`${days} days`} selected={currentConnection.healthConnectSyncWindowDays === days} onPress={() => { void update({ healthConnectSyncWindowDays: days }); }} />)}
        </View>
      </Card>
      {!currentConnection.healthConnectDisclosureAcknowledged ? (
        <Card>
          <Text style={styles.body}>Selected health records are sent read-only to your paired PC over the pinned local connection. They are not sold or used for advertising.</Text>
          <Button disabled={updating || syncing} secondary onPress={() => { void openPrivacyPolicy(); }}>Privacy policy</Button>
          <Button disabled={updating || syncing} onPress={() => { void update({ healthConnectDisclosureAcknowledged: true }); }}>{updating ? "Saving…" : "I understand and continue"}</Button>
        </Card>
      ) : <Button disabled={updating || syncing} secondary onPress={() => { void openPrivacyPolicy(); }}>Privacy policy</Button>}
      <Button disabled={syncing || updating || !currentConnection.healthConnectDisclosureAcknowledged} onPress={() => { void sync(); }}>{syncing ? "Syncing…" : updating ? "Saving settings…" : "Sync now"}</Button>
      {syncing ? (
        <View accessibilityLiveRegion="polite" accessibilityRole="progressbar" style={styles.syncProgress}>
          <ActivityIndicator color={colors.primary} />
          <View style={styles.flex}>
            <Text style={styles.heading}>Sync in progress</Text>
            <Text style={styles.meta}>{syncProgress}</Text>
          </View>
        </View>
      ) : null}
      {status ? <Message title={statusTone === "success" ? (status.startsWith("Sync start date reset.") ? "Sync start date reset" : "Sync complete") : "Could not sync"} detail={status} tone={statusTone} /> : null}
      {status && statusTone === "success" ? <ViewImportedDataButton /> : null}
      <Card>
        <Pressable
          accessibilityHint="Shows sync start date and reset controls"
          accessibilityRole="button"
          accessibilityState={{ disabled: updating || syncing, expanded: advancedOpen }}
          disabled={updating || syncing}
          onPress={() => setAdvancedOpen((open) => !open)}
          style={({ pressed }) => [styles.advancedToggle, pressed && styles.advancedTogglePressed]}
        >
          <View style={styles.flex}>
            <Text style={styles.heading}>Advanced settings</Text>
            <Text style={styles.meta}>Sync start date and reset</Text>
          </View>
          {advancedOpen ? <ChevronUp color={colors.muted} size={20} /> : <ChevronDown color={colors.muted} size={20} />}
        </Pressable>
        {advancedOpen ? (
          <View style={styles.advancedContent}>
            <View>
              <Text style={styles.label}>Sync start date</Text>
              <Text style={styles.body}>{formatSyncCursor(currentConnection.healthConnectSyncCursor)}</Text>
              <Text style={styles.meta}>
                {currentConnection.healthConnectSyncCursor
                  ? "Future syncs include a short overlap before this date to avoid missing readings."
                  : `The next sync will include the full selected ${currentConnection.healthConnectSyncWindowDays}-day window.`}
              </Text>
            </View>
            <Button danger disabled={!currentConnection.healthConnectSyncCursor || updating || syncing} onPress={confirmResetSyncCursor}>Reset sync start date</Button>
          </View>
        ) : null}
      </Card>
    </ScrollView>
  );
}

function ViewImportedDataButton() {
  const navigation = useNavigation<BottomTabNavigationProp<TabParamList>>();
  return <Button onPress={() => navigation.navigate("Track")}>View in Track</Button>;
}

function parseNumericInput(value: string): number {
  return value.trim() ? Number(value) : Number.NaN;
}

function formatObservedDate(date: Date): string {
  return date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

function formatDateOnly(value: string): string {
  return dateOnlyToLocalDate(value).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

function formatSyncCursor(cursor: string | null): string {
  if (!cursor) return "No previous Health Connect sync is stored.";
  const date = new Date(cursor);
  return Number.isNaN(date.getTime())
    ? `Stored date: ${cursor}`
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function Chip({ label, selected, disabled = false, onPress }: { label: string; selected: boolean; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress} style={[styles.chip, selected && styles.chipSelected, disabled && styles.chipDisabled]}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  sourceContent: { gap: spacing.lg, paddingBottom: spacing.xl },
  sourceTitle: { color: colors.textStrong, fontSize: type.display, fontWeight: "800" },
  sourceIntro: { color: colors.muted, fontSize: type.body, lineHeight: 20, marginTop: spacing.xs },
  sourceList: { gap: spacing.sm },
  sourceRow: { alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flexDirection: "row", gap: spacing.md, minHeight: 104, padding: spacing.md },
  sourcePressed: { backgroundColor: colors.surfaceMuted },
  sourceDisabled: { opacity: 0.62 },
  sourceIcon: { alignItems: "center", borderRadius: radii.md, height: 46, justifyContent: "center", width: 46 },
  sourceText: { flex: 1, gap: spacing.xs },
  sourceNameRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  sourceName: { color: colors.textStrong, fontSize: type.title, fontWeight: "800" },
  sourceDetail: { color: colors.muted, fontSize: type.body, lineHeight: 20 },
  recommended: { backgroundColor: colors.infoMuted, borderRadius: radii.pill, color: colors.info, fontSize: type.label, fontWeight: "800", overflow: "hidden", paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  lockedBadge: { alignItems: "center", backgroundColor: colors.surfaceMuted, borderRadius: radii.pill, flexDirection: "row", gap: 4, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  lockedText: { color: colors.muted, fontSize: type.label, fontWeight: "800" },
  demoUnavailable: { color: colors.info, fontSize: type.label, fontWeight: "700" },
  localNote: { color: colors.muted, fontSize: type.label, lineHeight: 18, paddingHorizontal: spacing.sm, textAlign: "center" },
  flowHeader: { alignItems: "center", flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  flowHeadingText: { flex: 1, minWidth: 0 },
  backButton: { alignItems: "center", height: 44, justifyContent: "center", width: 44 },
  flowTitle: { color: colors.textStrong, fontSize: type.heading, fontWeight: "800" },
  flowSubtitle: { color: colors.muted, fontSize: type.label },
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.pill, borderWidth: 1, minHeight: 44, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipDisabled: { opacity: 0.55 },
  chipText: { color: colors.text, fontSize: type.label, fontWeight: "600" },
  chipTextSelected: { color: "#fff" },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.sm, borderWidth: 1, color: colors.text, minHeight: 46, paddingHorizontal: spacing.sm },
  field: { gap: spacing.xs },
  pickerField: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.sm, borderWidth: 1, height: 56, overflow: "hidden" },
  picker: { color: colors.text, height: 56 },
  dateField: { alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.sm, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", minHeight: 58, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  dateFieldPressed: { backgroundColor: colors.surfaceMuted },
  dateFieldDisabled: { opacity: 0.55 },
  dateValue: { color: colors.text, fontSize: type.body, fontWeight: "700", marginTop: 2 },
  datePicker: { alignItems: "stretch", gap: spacing.sm, marginTop: spacing.sm },
  row: { alignItems: "center", flexDirection: "row", gap: spacing.sm, justifyContent: "space-between" },
  flex: { flex: 1 },
  label: { color: colors.muted, fontSize: type.label, fontWeight: "700" },
  heading: { color: colors.text, fontSize: type.title, fontWeight: "700" },
  body: { color: colors.text, fontSize: type.body, lineHeight: 21 },
  meta: { color: colors.muted, fontSize: type.label, lineHeight: 18 },
  syncProgress: { alignItems: "center", backgroundColor: colors.infoMuted, borderRadius: radii.md, flexDirection: "row", gap: spacing.md, padding: spacing.md },
  advancedToggle: { alignItems: "center", flexDirection: "row", minHeight: 44 },
  advancedTogglePressed: { opacity: 0.72 },
  advancedContent: { gap: spacing.md },
  reviewGroup: { gap: spacing.sm },
  reviewGroupHeading: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 44 },
  reviewGroupCount: { backgroundColor: colors.surfaceMuted, borderRadius: radii.pill, color: colors.text, fontSize: type.label, fontWeight: "800", minWidth: 30, overflow: "hidden", paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, textAlign: "center" },
  reviewGroupEmpty: { backgroundColor: colors.surfaceMuted, borderRadius: radii.sm, color: colors.muted, fontSize: type.label, lineHeight: 18, padding: spacing.md }
});
