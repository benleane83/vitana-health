import { useCallback, useEffect, useState } from "react";
import { FlatList, Platform, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Picker } from "@react-native-picker/picker";
import { useIsFocused } from "@react-navigation/native";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import {
  careItemKindCodes,
  careItemKindLabels,
  careItemReminderAt,
  defaultHealthEventKindForCareItem,
  healthEventKindCodes,
  healthEventKindLabels,
  isCareItemKind,
  normalizedCareItemKind,
  type CareItem,
  type CareItemKind,
  type CompleteCareItemInput,
  type CreateCareItemInput,
  type CreateHealthEventInput,
  type HealthEvent,
  type HealthEventKind,
  type Medication,
  type MedicationStatusFilter,
  type CreateMedicationInput
} from "@vitana/shared";
import { CalendarDays } from "lucide-react-native";
import { useMobileApi } from "../MobileApiProvider";
import { connectionStateLabel } from "../connectionState";
import type { TabParamList } from "../navigationTypes";
import { Button, Card, Message, Screen } from "../ui/components";

type MedicationDraft = Omit<CreateMedicationInput, "dose"> & { dose: string };
import { colors, radii, spacing, type } from "../ui/theme";
import { userFacingError } from "../userFacingError";

type CareView = "items" | "health-events" | "medications";
type EditorMode = "closed" | "create" | "edit" | "complete";
type Feedback = { detail: string; tone: "success" | "danger" };

const CARE_PAGE_SIZE = 30;

const defaultHealthEvent: CreateHealthEventInput = {
  kind: "other",
  status: "completed",
  occurredAt: dateOnlyIso(new Date()),
  provider: "",
  notes: ""
};

const defaultCareItem: CreateCareItemInput = {
  title: "",
  kind: "visit",
  priority: "normal",
  status: "open",
  notes: ""
};

const defaultMedication: MedicationDraft = {
  name: "",
  dose: "",
  unit: "",
  startDate: new Date().toISOString().slice(0, 10)
};

export function CareScreen({ navigation, route }: BottomTabScreenProps<TabParamList, "Care">) {
  const isFocused = useIsFocused();
  const {
    connectionState,
    demoMode,
    error,
    standaloneMode,
    listCareItems,
    listHealthEvents,
    synchronizeConnectedData,
    syncing,
    createCareItem,
    updateCareItem,
    completeCareItem,
    deleteCareItem,
    createHealthEvent,
    updateHealthEvent,
    deleteHealthEvent,
    listMedications,
    createMedication,
    updateMedication,
    deleteMedication
  } = useMobileApi();
  const [view, setView] = useState<CareView>("items");
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<CareItem[]>([]);
  const [events, setEvents] = useState<HealthEvent[]>([]);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [itemsHasMore, setItemsHasMore] = useState(false);
  const [eventsHasMore, setEventsHasMore] = useState(false);
  const [medicationsHasMore, setMedicationsHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [careItemKindFilter, setCareItemKindFilter] = useState<"" | CareItemKind>("");
  const [healthEventKindFilter, setHealthEventKindFilter] = useState<"" | HealthEventKind>("");
  const [medicationStatusFilter, setMedicationStatusFilter] = useState<"" | MedicationStatusFilter>("");
  const [editorMode, setEditorMode] = useState<EditorMode>("closed");
  const [editingId, setEditingId] = useState<string>();
  const [healthEventDraft, setHealthEventDraft] = useState<CreateHealthEventInput>(defaultHealthEvent);
  const [careItemDraft, setCareItemDraft] = useState<CreateCareItemInput>(defaultCareItem);
  const [medicationDraft, setMedicationDraft] = useState<MedicationDraft>(defaultMedication);
  const [completionDraft, setCompletionDraft] = useState<CompleteCareItemInput>({ occurredAt: dateOnlyIso(new Date()), kind: "other" });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();

  const load = useCallback(async (synchronize = false) => {
    setLoading(true);
    try {
      if (synchronize && !standaloneMode && !demoMode) await synchronizeConnectedData(true);
      const [nextItems, nextEvents, nextMedications] = await Promise.all([
        listCareItems({
          limit: CARE_PAGE_SIZE,
          kind: careItemKindFilter || undefined,
          includeId: route.params?.editCareItemId
        }),
        listHealthEvents({ limit: CARE_PAGE_SIZE, kind: healthEventKindFilter || undefined }),
        listMedications({ limit: CARE_PAGE_SIZE, status: medicationStatusFilter || undefined })
      ]);
      setItems(nextItems.items);
      setEvents(nextEvents.items);
      setMedications(nextMedications.items);
      setItemsHasMore(nextItems.hasMore);
      setEventsHasMore(nextEvents.hasMore);
      setMedicationsHasMore(nextMedications.hasMore);
    } catch (caught) {
      setFeedback({ detail: userFacingError(caught, "Unable to load care data. Try again."), tone: "danger" });
    } finally {
      setLoading(false);
    }
  }, [careItemKindFilter, demoMode, healthEventKindFilter, listCareItems, listHealthEvents, listMedications, medicationStatusFilter, route.params?.editCareItemId, standaloneMode, synchronizeConnectedData]);

  // Without this the list silently stopped at the first page, which reads to a user as data loss.
  async function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      if (view === "health-events") {
        const next = await listHealthEvents({ limit: CARE_PAGE_SIZE, offset: events.length, kind: healthEventKindFilter || undefined });
        setEvents((current) => [...current, ...next.items]);
        setEventsHasMore(next.hasMore);
      } else if (view === "medications") {
        const next = await listMedications({ limit: CARE_PAGE_SIZE, offset: medications.length, status: medicationStatusFilter || undefined });
        setMedications((current) => [...current, ...next.items]);
        setMedicationsHasMore(next.hasMore);
      } else {
        const next = await listCareItems({ limit: CARE_PAGE_SIZE, offset: items.length, kind: careItemKindFilter || undefined });
        setItems((current) => [...current, ...next.items]);
        setItemsHasMore(next.hasMore);
      }
    } catch (caught) {
      setFeedback({ detail: userFacingError(caught, "Unable to load more care records. Try again."), tone: "danger" });
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!isFocused || !route.params?.view) return;
    setView(route.params.view);
    setEditorMode("closed");
    setEditingId(undefined);
    setFeedback(undefined);
    navigation.setParams({ view: undefined });
  }, [isFocused, navigation, route.params?.view]);
  useEffect(() => {
    const editCareItemId = route.params?.editCareItemId;
    if (!isFocused || loading || !editCareItemId) return;
    const item = items.find((entry) => entry.id === editCareItemId);
    navigation.setParams({ editCareItemId: undefined });
    if (!item) {
      setFeedback({ detail: "This care item is no longer available.", tone: "danger" });
      return;
    }
    startEditCareItem(item);
  }, [isFocused, items, loading, navigation, route.params?.editCareItemId]);
  useEffect(() => {
    if (!isFocused) setFeedback(undefined);
  }, [isFocused]);
  useEffect(() => {
    if (feedback?.tone !== "success") return;
    const timeout = setTimeout(() => setFeedback(undefined), 4000);
    return () => clearTimeout(timeout);
  }, [feedback]);
  useEffect(() => {
    if (!demoMode && !standaloneMode && connectionState !== "online") {
      setEditorMode("closed");
      setEditingId(undefined);
    }
  }, [connectionState, demoMode, standaloneMode]);

  async function save() {
    setBusy(true);
    try {
      if (view === "health-events") {
        const payload = normalizeHealthEvent(healthEventDraft);
        if (editorMode === "edit" && editingId) await updateHealthEvent(editingId, payload);
        else await createHealthEvent(payload);
      } else if (view === "medications") {
        const payload = normalizeMedication(medicationDraft);
        if (editorMode === "edit" && editingId) await updateMedication(editingId, payload);
        else await createMedication(payload);
      } else {
        const payload = normalizeCareItem(careItemDraft);
        if (editorMode === "edit" && editingId) await updateCareItem(editingId, payload);
        else await createCareItem(payload);
      }
      setEditorMode("closed");
      setEditingId(undefined);
      setFeedback({ detail: view === "health-events" ? "Health event saved." : view === "medications" ? "Medication saved." : "Care item saved.", tone: "success" });
      await load();
    } catch (caught) {
      setFeedback({ detail: userFacingError(caught, "Unable to save care data. Try again."), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  async function confirmCompletion() {
    if (!editingId) return;
    const completingItem = items.find((entry) => entry.id === editingId);
    setBusy(true);
    try {
      await completeCareItem(editingId, completionDraft);
      setEditorMode("closed");
      setEditingId(undefined);
      setFeedback({ detail: completingItem?.kind === "monitoring" ? "Care item completed." : "Care item completed and health event recorded.", tone: "success" });
      await load();
    } catch (caught) {
      setFeedback({ detail: userFacingError(caught, "Unable to complete this care item. Try again."), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      if (view === "health-events") await deleteHealthEvent(id);
      else if (view === "medications") await deleteMedication(id);
      else await deleteCareItem(id);
      setFeedback({ detail: view === "health-events" ? "Health event deleted." : view === "medications" ? "Medication deleted." : "Care item deleted.", tone: "success" });
      await load();
    } catch (caught) {
      setFeedback({ detail: userFacingError(caught, "Unable to delete care data. Try again."), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  function startCreate() {
    setFeedback(undefined);
    setEditingId(undefined);
    setEditorMode("create");
    setHealthEventDraft(defaultHealthEvent);
    setCareItemDraft(defaultCareItem);
    setMedicationDraft(defaultMedication);
  }

  function startEditHealthEvent(entry: HealthEvent) {
    setFeedback(undefined);
    setView("health-events");
    setEditingId(entry.id);
    setHealthEventDraft({ kind: entry.kind, status: entry.status, occurredAt: entry.occurredAt, provider: entry.provider ?? "", notes: entry.notes ?? "" });
    setEditorMode("edit");
  }

  function startEditCareItem(entry: CareItem) {
    setFeedback(undefined);
    setView("items");
    setEditingId(entry.id);
    setCareItemDraft({ title: entry.title, kind: normalizedCareItemKind(entry.kind), dueStart: entry.dueStart, reminderAt: entry.reminderAt, priority: entry.priority, status: entry.status, notes: entry.notes ?? "" });
    setEditorMode("edit");
  }

  function startEditMedication(entry: Medication) {
    setFeedback(undefined);
    setView("medications");
    setEditingId(entry.id);
    setMedicationDraft({
      name: entry.name,
      activeIngredient: entry.activeIngredient,
      dose: entry.dose === undefined ? "" : String(entry.dose),
      unit: entry.unit ?? "",
      startDate: entry.startDate,
      endDate: entry.endDate,
      notes: entry.notes
    });
    setEditorMode("edit");
  }

  function startCompleteCareItem(entry: CareItem) {
    setFeedback(undefined);
    setView("items");
    setEditingId(entry.id);
    setCompletionDraft({
      occurredAt: dateOnlyIso(new Date()),
      kind: defaultHealthEventKindForCareItem[normalizedCareItemKind(entry.kind)]
    });
    setEditorMode("complete");
  }

  function switchView(nextView: CareView) {
    setFeedback(undefined);
    setView(nextView);
    setEditorMode("closed");
    setEditingId(undefined);
  }

  const canWrite = demoMode || standaloneMode || connectionState === "online";

  const listData: Array<CareItem | HealthEvent | Medication> = editorMode === "closed"
    ? view === "health-events" ? events : view === "medications" ? medications : items
    : [];
  const renderRow = (entry: CareItem | HealthEvent | Medication) => ("occurredAt" in entry ? (
    <Card>
      <Text style={styles.title}>{healthEventKindLabels[entry.kind]}</Text>
      <Text style={styles.meta}>{formatDate(entry.occurredAt)}{entry.provider ? ` • ${entry.provider}` : ""}</Text>
      {entry.notes ? <Text style={styles.meta}>{entry.notes}</Text> : null}
      {canWrite ? <View style={styles.actions}><Button disabled={busy} secondary onPress={() => startEditHealthEvent(entry)}>Edit</Button><Button disabled={busy} secondary onPress={() => { void remove(entry.id); }}>Delete</Button></View> : null}
    </Card>
  ) : !("title" in entry) ? (
    <Card>
      <Text style={styles.title}>{entry.name}{entry.activeIngredient ? ` (${entry.activeIngredient})` : ""}</Text>
      {entry.dose !== undefined || entry.unit
        ? <Text style={styles.meta}>{[entry.dose, entry.unit].filter((value) => value !== undefined && value !== "").join(" ")}</Text>
        : null}
      {entry.startDate ? <Text style={styles.meta}>Started {formatDate(entry.startDate)}</Text> : null}
      {canWrite ? <View style={styles.actions}><Button disabled={busy} secondary onPress={() => startEditMedication(entry)}>Edit</Button><Button disabled={busy} secondary onPress={() => { void remove(entry.id); }}>Delete</Button></View> : null}
    </Card>
  ) : (
    <Card>
      <Text style={styles.title}>{entry.title}</Text>
      <Text style={styles.meta}>{entry.status} • {careItemKindLabel(entry.kind)}</Text>
      <Text style={styles.meta}>{entry.dueStart ? `Due ${formatDate(entry.dueStart)}` : "No due date"}</Text>
      {canWrite ? (
        <View style={styles.actions}>
          {entry.status === "open" ? <Button disabled={busy} onPress={() => startCompleteCareItem(entry)}>Complete</Button> : null}
          <Button disabled={busy} secondary onPress={() => startEditCareItem(entry)}>Edit</Button>
          <Button disabled={busy} secondary onPress={() => { void remove(entry.id); }}>Delete</Button>
        </View>
      ) : null}
    </Card>
  ));

  return (
    <Screen>
      {/* Virtualized: Care lists grow without bound, and every card used to mount on first render. */}
      <FlatList
        ListHeaderComponent={
          <View style={styles.section}>
            <View style={styles.headerRow}>
              <View style={styles.segmented}>
                {(["items", "health-events", "medications"] as const).map((value) => (
                  <Pressable
                    accessibilityRole="tab"
                    accessibilityState={{ selected: view === value }}
                    key={value}
                    onPress={() => switchView(value)}
                    style={[styles.segment, view === value && styles.segmentActive]}
                  >
                    <Text style={[styles.segmentText, view === value && styles.segmentTextActive]}>{value === "items" ? "Care items" : value === "health-events" ? "Events" : "Medications"}</Text>
                  </Pressable>
                ))}
              </View>
              {canWrite && editorMode === "closed" ? <Button disabled={busy} onPress={startCreate}>{view === "items" ? "Add care item" : view === "health-events" ? "Add health event" : "Add medication"}</Button> : null}
            </View>
            {demoMode ? <Message title="Demo care records" detail="Try adding, editing, or completing records. Your changes reset when Demo mode restarts." /> : null}
            {!demoMode && !standaloneMode && connectionState !== "online" ? <Message title={connectionStateLabel(connectionState)} detail={error ?? "Showing read-only Care data. Reconnect or pull to refresh."} tone="warning" /> : null}
            {feedback ? <Message title={feedback.tone === "success" ? "Care updated" : "Care error"} detail={feedback.detail} tone={feedback.tone} /> : null}
            {editorMode === "closed" ? (
              view === "items" ? (
                <FormField label="Type filter">
                  <View style={styles.pickerField}>
                    <Picker
                      accessibilityLabel="Care item type filter"
                      selectedValue={careItemKindFilter}
                      style={styles.picker}
                      onValueChange={(value) => setCareItemKindFilter(value as "" | CareItemKind)}
                    >
                      <Picker.Item label="All types" value="" />
                      {careItemKindCodes.map((kind) => <Picker.Item key={kind} label={careItemKindLabels[kind]} value={kind} />)}
                    </Picker>
                  </View>
                </FormField>
              ) : view === "health-events" ? (
                <FormField label="Type filter">
                  <View style={styles.pickerField}>
                    <Picker
                      accessibilityLabel="Health event type filter"
                      selectedValue={healthEventKindFilter}
                      style={styles.picker}
                      onValueChange={(value) => setHealthEventKindFilter(value as "" | HealthEventKind)}
                    >
                      <Picker.Item label="All types" value="" />
                      {healthEventKindCodes.map((kind) => <Picker.Item key={kind} label={healthEventKindLabels[kind]} value={kind} />)}
                    </Picker>
                  </View>
                </FormField>
              ) : view === "medications" ? (
                <FormField label="Status filter">
                  <View style={styles.pickerField}>
                    <Picker
                      accessibilityLabel="Medication status filter"
                      selectedValue={medicationStatusFilter}
                      style={styles.picker}
                      onValueChange={(value) => setMedicationStatusFilter(value as "" | MedicationStatusFilter)}
                    >
                      <Picker.Item label="All" value="" />
                      <Picker.Item label="Active" value="active" />
                      <Picker.Item label="Past" value="past" />
                    </Picker>
                  </View>
                </FormField>
              ) : null
            ) : null}
          </View>
        }
        contentContainerStyle={styles.listContent}
        data={listData}
        keyExtractor={(entry) => entry.id}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading || syncing} onRefresh={() => { setFeedback(undefined); void load(true); }} />}
        renderItem={({ item }) => renderRow(item)}
        ListFooterComponent={
          <View style={styles.section}>
        {editorMode === "closed" && (view === "health-events" ? eventsHasMore : view === "medications" ? medicationsHasMore : itemsHasMore) ? (
          <Button disabled={loadingMore} secondary onPress={() => { void loadMore(); }}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        ) : null}
        {editorMode !== "closed" ? (
          <Card>
            <Text style={styles.heading}>{editorMode === "complete" ? "Complete care item" : editorMode === "create" ? `New ${view === "health-events" ? "health event" : view === "medications" ? "medication" : "care item"}` : `Edit ${view === "health-events" ? "health event" : view === "medications" ? "medication" : "care item"}`}</Text>
            {editorMode === "complete" ? (
              <>
                <FormField label="Date">
                  <DatePickerField
                    accessibilityLabel="Completion date"
                    disabled={busy}
                    onChange={(occurredAt) => setCompletionDraft((current) => ({ ...current, occurredAt }))}
                    value={completionDraft.occurredAt}
                  />
                </FormField>
                {items.find((entry) => entry.id === editingId)?.kind !== "monitoring" ? <FormField label="Type">
                  <View style={styles.pickerField}>
                    <Picker accessibilityLabel="Completion health event type" enabled={!busy} selectedValue={completionDraft.kind} style={styles.picker} onValueChange={(value) => setCompletionDraft((current) => ({ ...current, kind: value as HealthEventKind }))}>
                      {healthEventKindCodes.map((kind) => <Picker.Item key={kind} label={healthEventKindLabels[kind]} value={kind} />)}
                    </Picker>
                  </View>
                </FormField> : null}
                <View style={styles.actions}>
                  <Button disabled={busy || !canWrite} onPress={() => { void confirmCompletion(); }}>{busy ? "Completing…" : "Confirm completion"}</Button>
                  <Button disabled={busy} secondary onPress={() => setEditorMode("closed")}>Cancel</Button>
                </View>
              </>
            ) : view === "health-events" ? (
              <>
                <FormField label="Type">
                  <View style={styles.pickerField}>
                    <Picker accessibilityLabel="Type" selectedValue={healthEventDraft.kind} style={styles.picker} onValueChange={(value) => setHealthEventDraft((current) => ({ ...current, kind: value as CreateHealthEventInput["kind"] }))}>
                      {healthEventKindCodes.map((kind) => <Picker.Item key={kind} label={healthEventKindLabels[kind]} value={kind} />)}
                    </Picker>
                  </View>
                </FormField>
                <FormField label="Date">
                  <DatePickerField
                    accessibilityLabel="Health event date"
                    disabled={busy}
                    onChange={(occurredAt) => setHealthEventDraft((current) => ({ ...current, occurredAt }))}
                    value={healthEventDraft.occurredAt}
                  />
                </FormField>
                <FormField label="Provider (optional)">
                  <TextInput accessibilityLabel="Provider" placeholder="Provider or clinic" placeholderTextColor={colors.muted} style={styles.input} value={healthEventDraft.provider ?? ""} onChangeText={(value) => setHealthEventDraft((current) => ({ ...current, provider: value }))} />
                </FormField>
                <FormField label="Notes (optional)">
                  <TextInput accessibilityLabel="Notes" multiline placeholder="Add context" placeholderTextColor={colors.muted} style={[styles.input, styles.notesInput]} value={healthEventDraft.notes ?? ""} onChangeText={(value) => setHealthEventDraft((current) => ({ ...current, notes: value }))} />
                </FormField>
              </>
            ) : view === "medications" ? (
              <>
                <FormField label="Name">
                  <TextInput accessibilityLabel="Medication name" placeholder="Medication name" placeholderTextColor={colors.muted} style={styles.input} value={medicationDraft.name} onChangeText={(value) => setMedicationDraft((current) => ({ ...current, name: value }))} />
                </FormField>
                <FormField label="Active Ingredient(s) (optional)">
                  <TextInput accessibilityLabel="Active Ingredient(s)" placeholder="Generic ingredient" placeholderTextColor={colors.muted} style={styles.input} value={medicationDraft.activeIngredient ?? ""} onChangeText={(value) => setMedicationDraft((current) => ({ ...current, activeIngredient: value }))} />
                </FormField>
                <FormField label="Dose (optional)">
                  <TextInput accessibilityLabel="Dose" keyboardType="decimal-pad" placeholder="1" placeholderTextColor={colors.muted} style={styles.input} value={medicationDraft.dose} onChangeText={(value) => setMedicationDraft((current) => ({ ...current, dose: value }))} />
                </FormField>
                <FormField label="Unit (optional)">
                  <TextInput accessibilityLabel="Dose unit" placeholder="mg" placeholderTextColor={colors.muted} style={styles.input} value={medicationDraft.unit ?? ""} onChangeText={(value) => setMedicationDraft((current) => ({ ...current, unit: value }))} />
                </FormField>
                <FormField label="Start date">
                  <DatePickerField accessibilityLabel="Medication start date" disabled={busy} onChange={(startDate) => setMedicationDraft((current) => ({ ...current, startDate }))} onClear={() => setMedicationDraft((current) => ({ ...current, startDate: undefined }))} value={medicationDraft.startDate} />
                </FormField>
                <FormField label="End date (optional)">
                  <DatePickerField accessibilityLabel="Medication end date" disabled={busy} minimumDate={dateFromIso(medicationDraft.startDate)} onChange={(endDate) => setMedicationDraft((current) => ({ ...current, endDate }))} onClear={() => setMedicationDraft((current) => ({ ...current, endDate: undefined }))} value={medicationDraft.endDate} />
                </FormField>
                <FormField label="Notes (optional)">
                  <TextInput accessibilityLabel="Medication notes" multiline placeholder="Add context" placeholderTextColor={colors.muted} style={[styles.input, styles.notesInput]} value={medicationDraft.notes ?? ""} onChangeText={(value) => setMedicationDraft((current) => ({ ...current, notes: value }))} />
                </FormField>
              </>
            ) : (
              <>
                <FormField label="Title">
                  <TextInput accessibilityLabel="Title" placeholder="What needs care?" placeholderTextColor={colors.muted} style={styles.input} value={careItemDraft.title} onChangeText={(value) => setCareItemDraft((current) => ({ ...current, title: value }))} />
                </FormField>
                <FormField label="Type">
                  <View style={styles.pickerField}>
                    <Picker accessibilityLabel="Type" selectedValue={careItemDraft.kind} style={styles.picker} onValueChange={(value) => setCareItemDraft((current) => ({ ...current, kind: value as CreateCareItemInput["kind"] }))}>
                      {careItemKindCodes.map((kind) => <Picker.Item key={kind} label={careItemKindLabels[kind]} value={kind} />)}
                    </Picker>
                  </View>
                </FormField>
                <FormField label="Status">
                  {careItemDraft.status === "completed" ? (
                    <View accessibilityLabel="Status: Completed" accessibilityRole="text" style={styles.fixedStatus}>
                      <Text style={styles.fixedStatusText}>Completed</Text>
                    </View>
                  ) : (
                    <View style={styles.pickerField}>
                      <Picker accessibilityLabel="Status" selectedValue={careItemDraft.status} style={styles.picker} onValueChange={(value) => setCareItemDraft((current) => ({ ...current, status: value as CreateCareItemInput["status"] }))}>
                        <Picker.Item label="Open" value="open" />
                        <Picker.Item label="Cancelled" value="cancelled" />
                      </Picker>
                    </View>
                  )}
                </FormField>
                <FormField label="Due date (optional)">
                  <DatePickerField
                    accessibilityLabel="Due date"
                    disabled={busy}
                    onChange={(dueStart) => setCareItemDraft((current) => ({ ...current, dueStart }))}
                    onClear={() => setCareItemDraft((current) => ({ ...current, dueStart: undefined }))}
                    value={careItemDraft.dueStart}
                  />
                </FormField>
                <FormField label="Reminder date (optional)">
                  <DatePickerField
                    accessibilityLabel="Reminder date"
                    disabled={busy}
                    onChange={(reminderAt) => setCareItemDraft((current) => ({ ...current, reminderAt }))}
                    onClear={() => setCareItemDraft((current) => ({ ...current, reminderAt: undefined }))}
                    value={careItemDraft.reminderAt}
                  />
                  <View style={styles.presetRow}>
                    {(["one-day", "one-week"] as const).map((lead) => {
                      const label = lead === "one-day" ? "1 day before" : "1 week before";
                      const disabled = busy || !careItemDraft.dueStart;
                      return (
                        <Pressable
                          accessibilityHint={careItemDraft.dueStart ? `Sets the reminder date to ${label.toLowerCase()} the due date` : "Set a due date before using this preset"}
                          accessibilityLabel={`Reminder preset: ${label}`}
                          accessibilityRole="button"
                          accessibilityState={{ disabled }}
                          disabled={disabled}
                          key={lead}
                          onPress={() => {
                            const reminderAt = careItemReminderAt(careItemDraft.dueStart, lead);
                            if (reminderAt) setCareItemDraft((current) => ({ ...current, reminderAt }));
                          }}
                          style={({ pressed }) => [styles.presetButton, pressed && styles.presetButtonPressed, disabled && styles.presetButtonDisabled]}
                        >
                          <Text style={styles.presetButtonText}>{label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {!careItemDraft.dueStart ? <Text accessibilityLiveRegion="polite" style={styles.presetHelp}>Set a due date to use reminder presets.</Text> : null}
                </FormField>
                <FormField label="Notes (optional)">
                  <TextInput accessibilityLabel="Notes" multiline placeholder="Add context" placeholderTextColor={colors.muted} style={[styles.input, styles.notesInput]} value={careItemDraft.notes ?? ""} onChangeText={(value) => setCareItemDraft((current) => ({ ...current, notes: value }))} />
                </FormField>
              </>
            )}
            {editorMode !== "complete" ? <View style={styles.actions}><Button disabled={busy || !canWrite} onPress={() => { void save(); }}>{busy ? "Saving…" : "Save"}</Button><Button disabled={busy} secondary onPress={() => setEditorMode("closed")}>Cancel</Button></View> : null}
          </Card>
        ) : null}
          </View>
        }
      />
    </Screen>
  );
}

function FormField({ children, label }: { children: React.ReactNode; label: string }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text>{children}</View>;
}

function DatePickerField({
  accessibilityLabel,
  disabled,
  minimumDate,
  onChange,
  onClear,
  value
}: {
  accessibilityLabel: string;
  disabled: boolean;
  minimumDate?: Date;
  onChange: (value: string) => void;
  onClear?: () => void;
  value?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedDate = dateFromIso(value) ?? new Date();

  return (
    <>
      <View style={styles.dateFieldActions}>
        <Pressable
          accessibilityHint={`Opens the ${accessibilityLabel.toLowerCase()} picker`}
          accessibilityLabel={`${accessibilityLabel}: ${value ? formatDate(value) : "not set"}`}
          accessibilityRole="button"
          disabled={disabled}
          onPress={() => setOpen(true)}
          style={({ pressed }) => [styles.dateField, pressed && styles.dateFieldPressed, disabled && styles.dateFieldDisabled]}
        >
          <Text style={[styles.dateValue, !value && styles.datePlaceholder]}>{value ? formatDate(value) : "Choose date"}</Text>
          <CalendarDays color={colors.primary} size={21} />
        </Pressable>
        {value && onClear ? <Button disabled={disabled} secondary onPress={onClear}>Clear</Button> : null}
      </View>
      {open ? (
        <View style={styles.datePicker}>
          <DateTimePicker
            minimumDate={minimumDate}
            mode="date"
            onChange={(_event, selected) => {
              if (selected) onChange(dateOnlyIso(selected));
              if (Platform.OS !== "ios") setOpen(false);
            }}
            value={selectedDate}
          />
          {Platform.OS === "ios" ? <Button secondary onPress={() => setOpen(false)}>Done</Button> : null}
        </View>
      ) : null}
    </>
  );
}

function normalizeHealthEvent(draft: CreateHealthEventInput): CreateHealthEventInput {
  return { ...draft, provider: draft.provider?.trim() || undefined, notes: draft.notes?.trim() || undefined };
}

function normalizeCareItem(draft: CreateCareItemInput): CreateCareItemInput {
  return { ...draft, title: draft.title.trim(), notes: draft.notes?.trim() || undefined };
}

function normalizeMedication(draft: MedicationDraft): CreateMedicationInput {
  return {
    name: draft.name.trim(),
    activeIngredient: draft.activeIngredient?.trim() || undefined,
    dose: draft.dose.trim() ? Number(draft.dose) : undefined,
    unit: draft.unit?.trim() || undefined,
    startDate: draft.startDate?.slice(0, 10) || undefined,
    endDate: draft.endDate?.slice(0, 10) || undefined,
    notes: draft.notes?.trim() || undefined
  };
}

function careItemKindLabel(kind: string): string {
  if (isCareItemKind(kind)) return careItemKindLabels[kind];
  return kind;
}

function dateFromIso(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function dateOnlyIso(value: Date): string {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function formatDate(value: string): string {
  const date = dateFromIso(value);
  return date
    ? date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : "Date unavailable";
}

const styles = StyleSheet.create({
  listContent: { gap: spacing.md, paddingBottom: spacing.xl },
  section: { gap: spacing.md },
  headerRow: { gap: spacing.md },
  segmented: { flexDirection: "row", gap: spacing.sm },
  segment: { alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 999, borderWidth: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  segmentActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  segmentText: { color: colors.text, fontWeight: "700" },
  segmentTextActive: { color: colors.onAccent },
  title: { color: colors.text, fontSize: 17, fontWeight: "700" },
  heading: { color: colors.textStrong, fontSize: type.title, fontWeight: "800" },
  field: { gap: spacing.xs },
  label: { color: colors.muted, fontSize: type.label, fontWeight: "700" },
  meta: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  pickerField: { backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: radii.sm, borderWidth: 1, height: 56, overflow: "hidden" },
  picker: { color: colors.text, height: 56 },
  fixedStatus: { backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: radii.sm, borderWidth: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: spacing.md },
  fixedStatusText: { color: colors.text, fontSize: type.body, fontWeight: "700" },
  dateFieldActions: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  dateField: { alignItems: "center", backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: radii.sm, borderWidth: 1, flex: 1, flexDirection: "row", justifyContent: "space-between", minHeight: 48, paddingHorizontal: spacing.md },
  dateFieldPressed: { backgroundColor: colors.primaryMuted },
  dateFieldDisabled: { opacity: 0.5 },
  dateValue: { color: colors.text, flex: 1, fontSize: type.body, fontWeight: "700" },
  datePlaceholder: { color: colors.muted, fontWeight: "400" },
  datePicker: { backgroundColor: colors.surfaceMuted, borderRadius: radii.sm, gap: spacing.sm, padding: spacing.sm },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  presetButton: { alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.sm, borderWidth: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: spacing.md },
  presetButtonPressed: { backgroundColor: colors.primaryMuted },
  presetButtonDisabled: { opacity: 0.5 },
  presetButtonText: { color: colors.text, fontSize: type.label, fontWeight: "700" },
  presetHelp: { color: colors.muted, fontSize: type.label, lineHeight: 19 },
  input: { backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: radii.sm, borderWidth: 1, color: colors.text, fontSize: type.body, minHeight: 48, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  notesInput: { minHeight: 112, textAlignVertical: "top" }
});
