import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { File } from "expo-file-system";
import { useKeepAwake } from "expo-keep-awake";
import { ArrowLeft, CalendarDays, ChevronDown, ChevronRight, ChevronUp, PencilLine, RefreshCw, ScanLine } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Picker } from "@react-native-picker/picker";
import {
  calendarDateToUtcMidnight,
  defaultMeasurementTypes,
  filterManualGroupTemplates,
  findKnownMeasurement,
  getPreferredUnit,
  hasFeature,
  healthConnectSyncWindowForTier,
  manualGroupDefaults,
  normalizeGroupLabel,
  type HealthSourceSyncProgress,
  type BloodTestDraft,
  type BodyCompositionDraft,
  type ManualObservationPayload
} from "@vitana/shared";
import { createCompanionApi } from "../api";
import { useEntitlement } from "../EntitlementProvider";
import {
  HEALTH_CONNECT_SYNC_WINDOW_OPTIONS,
  saveConnection,
  updateHealthSourceCursors,
  updateHealthSourceSessionKey,
  type HealthConnectCategory
} from "../endpointStore";
import { earliestHealthSourceCursor } from "../healthSourceCursor";
import { healthSourceSyncCoordinator, shouldCancelHealthSourceSync } from "../healthSourceSyncCoordinator";
import { activeHealthSourceProvider } from "../healthSourceProvider";
import { useMobileApi } from "../MobileApiProvider";
import type { RootStackParamList, TabParamList } from "../navigationTypes";
import { LONG_RUNNING_PINNED_REQUEST_TIMEOUT_MS } from "../pinnedFetch";
import { userFacingError } from "../userFacingError";
import { Button, Card, Message, Screen } from "../ui/components";
import { colors, radii, spacing, type } from "../ui/theme";
import {
  dateOnlyToLocalDate,
  groupScanRows,
  localDateOnly,
  newScanReportRow,
  scanReportDate,
  shouldRemoveScanReportRowOnExclude,
  toCommittedScanRows,
  toEditableScanRows,
  type ScanReportEditableRow
} from "./scanReportReview";
import { buildImportSourceOptions, type ImportSource, type ImportSourceOption } from "./importSourceOptions";

const privacyUrl = "https://vitanahealth.app/privacy";
type ScanKind = "body-composition" | "blood-test";

export function ImportScreen() {
  const { connectionState, demoMode, standaloneMode } = useMobileApi();
  const navigation = useNavigation<BottomTabNavigationProp<TabParamList, "Import">>();
  const [source, setSource] = useState<ImportSource>();
  const connectedOffline = !standaloneMode && connectionState !== "online";
  const healthSourceProvider = activeHealthSourceProvider();
  const sourceOptions = buildImportSourceOptions(healthSourceProvider, Platform.OS);
  useEffect(() => {
    if (demoMode || connectedOffline || (standaloneMode && source !== "manual") || (source === "sync" && !healthSourceProvider)) {
      setSource(undefined);
    }
  }, [connectedOffline, demoMode, healthSourceProvider, source, standaloneMode]);

  if (!source || demoMode || (source === "sync" && !healthSourceProvider)) return <ImportSourceChooser connectedOffline={connectedOffline} demoMode={demoMode} standaloneMode={standaloneMode} sources={sourceOptions} onSelect={setSource} onConnect={() => {
    navigation.getParent<NativeStackNavigationProp<RootStackParamList>>()?.navigate("Connection");
  }} />;

  const sourceTitle = source === "sync" ? "Sync" : source === "scan" ? "Scan a report" : "Enter manually";
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
      {source === "scan" ? <ScanImport /> : source === "manual" ? <ManualImport /> : <HealthConnectImport />}
    </Screen>
  );
}

function ImportSourceChooser({
  connectedOffline,
  demoMode,
  standaloneMode,
  sources,
  onConnect,
  onSelect
}: {
  connectedOffline: boolean;
  demoMode: boolean;
  standaloneMode: boolean;
  sources: ImportSourceOption[];
  onConnect: () => void;
  onSelect: (source: ImportSource) => void;
}) {
  const presentation: Record<ImportSource, { icon: typeof RefreshCw; color: string; background: string }> = {
    sync: { icon: RefreshCw, color: colors.info, background: colors.infoMuted },
    scan: { icon: ScanLine, color: colors.blush, background: colors.blushMuted },
    manual: { icon: PencilLine, color: colors.primary, background: colors.lavenderMuted }
  };

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
          {sources.map(({ source, title, detail }) => {
            const { icon: Icon, color, background } = presentation[source];
            const unavailableInStandalone = standaloneMode && source !== "manual";
            const disabled = demoMode || connectedOffline || unavailableInStandalone;
            const unavailableReason = demoMode ? "in Demo mode" : connectedOffline ? "while offline" : "until this phone is paired";
            return (
              <Pressable
                accessibilityHint={disabled ? `Unavailable ${unavailableReason}` : `Opens the ${title} flow`}
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
        observedAt: calendarDateToUtcMidnight(localDateOnly(date))!,
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
  const { bootstrap, connection, refreshAfterImport } = useMobileApi();
  const measurements = bootstrap?.measurementTypes?.length ? bootstrap.measurementTypes : defaultMeasurementTypes;
  const [kind, setKind] = useState<ScanKind>("body-composition");
  const [draft, setDraft] = useState<BodyCompositionDraft | BloodTestDraft>();
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
  }, [connection]);

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
        { compress: 0.72, format: ImageManipulator.SaveFormat.JPEG }
      );
      // Read the bounded JPEG at request time so the image-manipulator result does not retain an
      // additional base64 copy while the local-network JSON request is in flight.
      const contentBase64 = await new File(resized.uri).base64();
      if (!contentBase64) throw new Error("Could not read the selected image.");
      const next = kind === "body-composition"
        ? await client.previewBodyCompositionReport({ fileName: asset.fileName ?? "report.jpg", mimeType: "image/jpeg", contentBase64 })
        : await client.previewBloodTestReport({ fileName: asset.fileName ?? "report.jpg", mimeType: "image/jpeg", contentBase64 });
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

  function selectScanMeasurement(rowId: string, measurementCode: string) {
    const measurement = measurements.find((entry) => entry.code === measurementCode);
    setRows((current) => current.map((row) => row.id === rowId
      ? {
          ...row,
          measurementCode,
          label: measurement?.display ?? "Added measurement",
          displayName: measurement?.display ?? "Added measurement",
          unit: measurement ? getPreferredUnit(measurement, bootstrap?.profile.units ?? "metric") : ""
        }
      : row));
  }

  function setRowIncluded(row: ScanReportEditableRow, included: boolean) {
    if (!included && shouldRemoveScanReportRowOnExclude(row)) {
      setRows((current) => current.filter((entry) => entry.id !== row.id));
      return;
    }
    patchRow(row.id, { included });
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
        reportDate: calendarDateToUtcMidnight(reportDate),
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
        <View style={styles.row}><Text style={[styles.heading, styles.flex]}>{row.label}</Text><Switch accessibilityLabel={`Include ${row.label}`} disabled={busy} value={row.included} onValueChange={(included) => setRowIncluded(row, included)} /></View>
        {row.manuallyAdded ? (
          <View style={styles.field}>
            <Text style={styles.label}>Measurement</Text>
            <View style={styles.pickerField}>
              <Picker
                accessibilityLabel="Measurement"
                enabled={!busy}
                onValueChange={(measurementCode) => selectScanMeasurement(row.id, String(measurementCode))}
                selectedValue={row.measurementCode}
                style={styles.picker}
              >
                <Picker.Item label="Choose a measurement" value="" />
                {measurements.map((measurement) => (
                  <Picker.Item key={measurement.code} label={measurement.display} value={measurement.code} />
                ))}
              </Picker>
            </View>
          </View>
        ) : (
          <>
            <Text style={styles.meta}>OCR confidence: {row.confidence}</Text>
            <TextInput accessibilityLabel={`Measurement for ${row.label}`} editable={!busy} style={styles.input} value={row.measurementCode} onChangeText={(measurementCode) => patchRow(row.id, { measurementCode })} />
          </>
        )}
        <View style={styles.row}>
          <TextInput accessibilityLabel={`Value for ${row.label}`} editable={!busy} style={[styles.input, styles.flex]} keyboardType="decimal-pad" value={row.value} onChangeText={(value) => patchRow(row.id, { value })} />
          <TextInput accessibilityLabel={`Unit for ${row.label}`} editable={!busy} style={[styles.input, styles.flex]} value={row.unit} onChangeText={(unit) => patchRow(row.id, { unit })} />
        </View>
      </Card>
    );
  }

  function renderGroup(title: string, groupRows: ScanReportEditableRow[], emptyMessage: string, allowAdd = false) {
    return (
      <View accessibilityLabel={`${title}, ${groupRows.length} ${groupRows.length === 1 ? "measurement" : "measurements"}`} style={styles.reviewGroup}>
        <View style={styles.reviewGroupHeading}>
          <Text style={styles.heading}>{title}</Text>
          <Text style={styles.reviewGroupCount}>{groupRows.length}</Text>
        </View>
        {groupRows.length ? groupRows.map(renderRow) : <Text style={styles.reviewGroupEmpty}>{emptyMessage}</Text>}
        {allowAdd ? <Button disabled={busy} secondary onPress={() => setRows((current) => [...current, newScanReportRow()])}>Add row</Button> : null}
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.chips}>
        <Chip disabled={busy} label="Body composition" selected={kind === "body-composition"} onPress={() => { setKind("body-composition"); resetReview(); }} />
        <Chip disabled={busy} label="Lab test" selected={kind === "blood-test"} onPress={() => { setKind("blood-test"); resetReview(); }} />
      </View>
      {!draft ? (
        <Card>
          <Text style={styles.body}>Images travel only over your local network for scanning on the PC. Nothing is committed until you approve the rows.</Text>
          <Button disabled={busy} onPress={() => { void acquire(true); }}>Take photo</Button>
          <Button disabled={busy} secondary onPress={() => { void acquire(false); }}>Choose from gallery</Button>
          {busy ? (
            <View accessibilityLiveRegion="polite" accessibilityRole="progressbar" style={styles.scanProgress}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.meta, styles.flex]}>Processing image on your paired PC…</Text>
            </View>
          ) : null}
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
          {renderGroup("Selected for save", groupedRows.selected, "Select at least one measurement to save it.", true)}
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
  const entitlement = useEntitlement();
  const extendedHistoryAllowed = hasFeature(entitlement.state.tier, "extended-health-connect-history");
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"success" | "danger">("success");
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState("");
  const [updating, setUpdating] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const syncStage = useRef<HealthSourceSyncProgress["stage"] | undefined>(undefined);
  // Rendered from the provider rather than a constant, so a device with no health source shows an
  // empty picker instead of offering categories nothing can read.
  const providerCategories = activeHealthSourceProvider()?.categories ?? [];
  useKeepAwake(syncing ? "health-connect-sync" : undefined);
  // Leaving the app abandons active reads rather than letting the OS kill one mid-batch. The
  // Health Connect permission activity is exempt because Android backgrounds this app while it is open.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (shouldCancelHealthSourceSync(state, syncStage.current)) healthSourceSyncCoordinator.cancel();
    });
    return () => subscription.remove();
  }, []);
  if (!connection) return <Message title="Pair with your PC before syncing." />;
  const currentConnection = connection;
  const earliestCursor = earliestHealthSourceCursor(
    currentConnection.healthSourceCursors,
    currentConnection.healthSourceCategories
  );

  async function update(patch: Partial<typeof currentConnection>): Promise<boolean> {
    if (updating || syncing) return false;
    setUpdating(true);
    try {
      await saveConnection({ ...currentConnection, ...patch });
      await reloadConnection({ preserveSession: true });
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
    if (await update({ healthSourceCursors: {}, healthSourceSessionKey: null })) {
      setStatusTone("success");
      setStatus(`Sync start date reset. Your next sync will include the full ${currentConnection.healthConnectSyncWindowDays}-day window.`);
    }
  }

  async function sync() {
    if (syncing || updating || healthSourceSyncCoordinator.busy) return;
    const provider = activeHealthSourceProvider();
    if (!provider) {
      setStatusTone("danger");
      setStatus("This device has no supported health data source.");
      return;
    }
    setSyncing(true);
    syncStage.current = undefined;
    setSyncProgress(`Checking ${provider.label} on this phone…`);
    try {
      const result = await healthSourceSyncCoordinator.run((signal) => provider.sync(
        currentConnection.url,
        currentConnection.token,
        bootstrap?.profile.id ?? null,
        currentConnection.publicKeyHash,
        {
          deviceId: currentConnection.deviceId,
          syncCursors: currentConnection.healthSourceCursors,
          sessionKey: currentConnection.healthSourceSessionKey,
          syncWindowDays: healthConnectSyncWindowForTier(entitlement.state.tier, currentConnection.healthConnectSyncWindowDays),
          categories: currentConnection.healthSourceCategories,
          onProgress: ({ detail, stage }) => {
            syncStage.current = stage;
            setSyncProgress(detail);
          },
          onSessionKey: (sessionKey) => updateHealthSourceSessionKey(currentConnection.url, sessionKey),
          signal
        }
      ));
      await updateHealthSourceCursors(currentConnection.url, result.syncCursors);
      setStatusTone("success");
      setStatus(`${result.status} ${result.details}`);
      setSyncProgress("Refreshing your imported readings…");
      await reloadConnection();
      await refreshAfterImport();
    } catch (caught) {
      setStatusTone("danger");
      setStatus(userFacingError(caught, "Sync failed. Check the connection to your paired PC and try again."));
    } finally {
      syncStage.current = undefined;
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
          {providerCategories.map((category) => (
            <Chip
              key={category}
              label={category}
              disabled={updating || syncing}
              selected={currentConnection.healthSourceCategories.includes(category)}
              onPress={() => {
                const categories: HealthConnectCategory[] = currentConnection.healthSourceCategories.includes(category)
                  ? currentConnection.healthSourceCategories.filter((entry) => entry !== category)
                  : [...currentConnection.healthSourceCategories, category];
                void update({ healthSourceCategories: categories });
              }}
            />
          ))}
        </View>
        <Text style={styles.heading}>Initial sync window</Text>
        <View style={styles.chips}>
          {HEALTH_CONNECT_SYNC_WINDOW_OPTIONS.map((days) => {
            const locked = days > 30 && !extendedHistoryAllowed;
            return <Chip disabled={updating || syncing} key={days} label={`${days} days${locked ? " · Pro" : ""}`} selected={currentConnection.healthConnectSyncWindowDays === days && !locked} onPress={() => {
              if (locked) {
                Alert.alert("Available in Vitana Pro", "The free tier can sync up to 30 days of Health Connect history.");
                return;
              }
              void update({ healthConnectSyncWindowDays: days });
            }} />;
          })}
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
              <Text style={styles.body}>{formatSyncCursor(earliestCursor)}</Text>
              <Text style={styles.meta}>
                {earliestCursor
                  ? "Future syncs include a short overlap before this date to avoid missing readings."
                  : `The next sync will include the full selected ${currentConnection.healthConnectSyncWindowDays}-day window.`}
              </Text>
            </View>
            <Button danger disabled={!earliestCursor || updating || syncing} onPress={confirmResetSyncCursor}>Reset sync start date</Button>
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

function base64ByteLength(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor(value.length * 3 / 4) - padding;
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
  scanProgress: { alignItems: "center", flexDirection: "row", gap: spacing.sm, paddingVertical: spacing.xs },
  advancedToggle: { alignItems: "center", flexDirection: "row", minHeight: 44 },
  advancedTogglePressed: { opacity: 0.72 },
  advancedContent: { gap: spacing.md },
  reviewGroup: { gap: spacing.sm },
  reviewGroupHeading: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 44 },
  reviewGroupCount: { backgroundColor: colors.surfaceMuted, borderRadius: radii.pill, color: colors.text, fontSize: type.label, fontWeight: "800", minWidth: 30, overflow: "hidden", paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, textAlign: "center" },
  reviewGroupEmpty: { backgroundColor: colors.surfaceMuted, borderRadius: radii.sm, color: colors.muted, fontSize: type.label, lineHeight: 18, padding: spacing.md }
});
