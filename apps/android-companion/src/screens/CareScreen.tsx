import { useCallback, useState } from "react";
import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Picker } from "@react-native-picker/picker";
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
  type HealthEventKind
} from "@vitana/shared";
import { useFocusEffect } from "@react-navigation/native";
import { CalendarDays } from "lucide-react-native";
import { useMobileApi } from "../MobileApiProvider";
import { Button, Card, Message, Screen } from "../ui/components";
import { colors, radii, spacing, type } from "../ui/theme";
import { userFacingError } from "../userFacingError";

type CareView = "items" | "health-events";
type EditorMode = "closed" | "create" | "edit" | "complete";

const defaultHealthEvent: CreateHealthEventInput = {
  kind: "other",
  status: "completed",
  occurredAt: dateOnlyIso(new Date()),
  provider: "",
  notes: ""
};

const defaultCareItem: CreateCareItemInput = {
  title: "",
  kind: "follow-up",
  priority: "normal",
  status: "open",
  notes: ""
};

export function CareScreen() {
  const {
    connectionState,
    demoMode,
    error,
    standaloneMode,
    listCareItems,
    listHealthEvents,
    createCareItem,
    updateCareItem,
    completeCareItem,
    deleteCareItem,
    createHealthEvent,
    updateHealthEvent,
    deleteHealthEvent
  } = useMobileApi();
  const [view, setView] = useState<CareView>("items");
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<CareItem[]>([]);
  const [events, setEvents] = useState<HealthEvent[]>([]);
  const [careItemKindFilter, setCareItemKindFilter] = useState<"" | CareItemKind>("");
  const [healthEventKindFilter, setHealthEventKindFilter] = useState<"" | HealthEventKind>("");
  const [editorMode, setEditorMode] = useState<EditorMode>("closed");
  const [editingId, setEditingId] = useState<string>();
  const [healthEventDraft, setHealthEventDraft] = useState<CreateHealthEventInput>(defaultHealthEvent);
  const [careItemDraft, setCareItemDraft] = useState<CreateCareItemInput>(defaultCareItem);
  const [completionDraft, setCompletionDraft] = useState<CompleteCareItemInput>({ occurredAt: dateOnlyIso(new Date()), kind: "other" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  const load = useCallback(async () => {
    if (standaloneMode) {
      setItems([]);
      setEvents([]);
      setLoading(false);
      setMessage(undefined);
      return;
    }
    setLoading(true);
    try {
      const [nextItems, nextEvents] = await Promise.all([
        listCareItems({ limit: 30, kind: careItemKindFilter || undefined }),
        listHealthEvents({ limit: 30, kind: healthEventKindFilter || undefined })
      ]);
      setItems(nextItems.items);
      setEvents(nextEvents.items);
    } catch (caught) {
      setMessage(userFacingError(caught, "Unable to load care data. Try again."));
    } finally {
      setLoading(false);
    }
  }, [careItemKindFilter, healthEventKindFilter, listCareItems, listHealthEvents, standaloneMode]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function save() {
    setBusy(true);
    try {
      if (view === "health-events") {
        const payload = normalizeHealthEvent(healthEventDraft);
        if (editorMode === "edit" && editingId) await updateHealthEvent(editingId, payload);
        else await createHealthEvent(payload);
      } else {
        const payload = normalizeCareItem(careItemDraft);
        if (editorMode === "edit" && editingId) await updateCareItem(editingId, payload);
        else await createCareItem(payload);
      }
      setEditorMode("closed");
      setEditingId(undefined);
      setMessage(view === "health-events" ? "Health event saved." : "Care item saved.");
      await load();
    } catch (caught) {
      setMessage(userFacingError(caught, "Unable to save care data. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function confirmCompletion() {
    if (!editingId) return;
    setBusy(true);
    try {
      await completeCareItem(editingId, completionDraft);
      setEditorMode("closed");
      setEditingId(undefined);
      setMessage("Care item completed and health event recorded.");
      await load();
    } catch (caught) {
      setMessage(userFacingError(caught, "Unable to complete this care item. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      if (view === "health-events") await deleteHealthEvent(id);
      else await deleteCareItem(id);
      setMessage(view === "health-events" ? "Health event deleted." : "Care item deleted.");
      await load();
    } catch (caught) {
      setMessage(userFacingError(caught, "Unable to delete care data. Try again."));
    } finally {
      setBusy(false);
    }
  }

  function startCreate() {
    setEditingId(undefined);
    setEditorMode("create");
    setHealthEventDraft(defaultHealthEvent);
    setCareItemDraft(defaultCareItem);
  }

  function startEditHealthEvent(entry: HealthEvent) {
    setView("health-events");
    setEditingId(entry.id);
    setHealthEventDraft({ kind: entry.kind, status: entry.status, occurredAt: entry.occurredAt, provider: entry.provider ?? "", notes: entry.notes ?? "" });
    setEditorMode("edit");
  }

  function startEditCareItem(entry: CareItem) {
    setView("items");
    setEditingId(entry.id);
    setCareItemDraft({ title: entry.title, kind: normalizedCareItemKind(entry.kind), dueStart: entry.dueStart, reminderAt: entry.reminderAt, priority: entry.priority, status: entry.status, notes: entry.notes ?? "" });
    setEditorMode("edit");
  }

  function startCompleteCareItem(entry: CareItem) {
    setView("items");
    setEditingId(entry.id);
    setCompletionDraft({
      occurredAt: dateOnlyIso(new Date()),
      kind: defaultHealthEventKindForCareItem[normalizedCareItemKind(entry.kind)]
    });
    setEditorMode("complete");
  }

  function switchView(nextView: CareView) {
    setView(nextView);
    setEditorMode("closed");
    setEditingId(undefined);
  }

  if (standaloneMode) {
    return (
      <Screen>
        <Message
          title="Care requires Connected mode"
          detail="Switch to Connected mode to view and manage Care records on your paired PC. Standalone health data remains separate and unchanged."
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { void load(); }} />}>
        <View style={styles.headerRow}>
          <View style={styles.segmented}>
            {(["items", "health-events"] as const).map((value) => (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: view === value }}
                key={value}
                onPress={() => switchView(value)}
                style={[styles.segment, view === value && styles.segmentActive]}
              >
                <Text style={[styles.segmentText, view === value && styles.segmentTextActive]}>{value === "items" ? "Care items" : "Health events"}</Text>
              </Pressable>
            ))}
          </View>
          {!demoMode ? <Button disabled={busy} onPress={startCreate}>{view === "items" ? "Add care item" : "Add health event"}</Button> : null}
        </View>
        {demoMode ? <Message title="Demo mode is read-only" detail="Connect to your paired PC to create, edit, or delete care records." /> : null}
        {connectionState !== "online" ? <Message title={connectionState.replaceAll("-", " ")} detail={error ?? "Reconnect to refresh Care data."} tone="warning" /> : null}
        {message ? <Message title="Care" detail={message} /> : null}
        {view === "items" ? (
          <FormField label="Kind filter">
            <View style={styles.pickerField}>
              <Picker
                accessibilityLabel="Care item kind filter"
                selectedValue={careItemKindFilter}
                style={styles.picker}
                onValueChange={(value) => setCareItemKindFilter(value as "" | CareItemKind)}
              >
                <Picker.Item label="All kinds" value="" />
                {careItemKindCodes.map((kind) => <Picker.Item key={kind} label={careItemKindLabels[kind]} value={kind} />)}
              </Picker>
            </View>
          </FormField>
        ) : (
          <FormField label="Kind filter">
            <View style={styles.pickerField}>
              <Picker
                accessibilityLabel="Health event kind filter"
                selectedValue={healthEventKindFilter}
                style={styles.picker}
                onValueChange={(value) => setHealthEventKindFilter(value as "" | HealthEventKind)}
              >
                <Picker.Item label="All kinds" value="" />
                {healthEventKindCodes.map((kind) => <Picker.Item key={kind} label={healthEventKindLabels[kind]} value={kind} />)}
              </Picker>
            </View>
          </FormField>
        )}
        {view === "health-events" ? events.map((entry) => (
          <Card key={entry.id}>
            <Text style={styles.title}>{healthEventKindLabels[entry.kind]}</Text>
            <Text style={styles.meta}>{formatDate(entry.occurredAt)}{entry.provider ? ` • ${entry.provider}` : ""}</Text>
            <Text style={styles.meta}>{entry.status}{entry.notes ? ` • ${entry.notes}` : ""}</Text>
            {!demoMode ? <View style={styles.actions}><Button disabled={busy} secondary onPress={() => startEditHealthEvent(entry)}>Edit</Button><Button disabled={busy} secondary onPress={() => { void remove(entry.id); }}>Delete</Button></View> : null}
          </Card>
        )) : items.map((entry) => (
          <Card key={entry.id}>
            <Text style={styles.title}>{entry.title}</Text>
            <Text style={styles.meta}>{entry.status} • {careItemKindLabel(entry.kind)}</Text>
            <Text style={styles.meta}>{entry.dueStart ? `Due ${formatDate(entry.dueStart)}` : "No due date"}</Text>
            {!demoMode ? (
              <View style={styles.actions}>
                {entry.status === "open" ? <Button disabled={busy} onPress={() => startCompleteCareItem(entry)}>Complete</Button> : null}
                <Button disabled={busy} secondary onPress={() => startEditCareItem(entry)}>Edit</Button>
                <Button disabled={busy} secondary onPress={() => { void remove(entry.id); }}>Delete</Button>
              </View>
            ) : null}
          </Card>
        ))}
        {editorMode !== "closed" ? (
          <Card>
            <Text style={styles.heading}>{editorMode === "complete" ? "Complete care item" : editorMode === "create" ? `New ${view === "health-events" ? "health event" : "care item"}` : `Edit ${view === "health-events" ? "health event" : "care item"}`}</Text>
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
                <FormField label="Kind">
                  <View style={styles.pickerField}>
                    <Picker accessibilityLabel="Completion health event kind" enabled={!busy} selectedValue={completionDraft.kind} style={styles.picker} onValueChange={(value) => setCompletionDraft((current) => ({ ...current, kind: value as HealthEventKind }))}>
                      {healthEventKindCodes.map((kind) => <Picker.Item key={kind} label={healthEventKindLabels[kind]} value={kind} />)}
                    </Picker>
                  </View>
                </FormField>
                <View style={styles.actions}>
                  <Button disabled={busy} onPress={() => { void confirmCompletion(); }}>{busy ? "Completing…" : "Confirm completion"}</Button>
                  <Button disabled={busy} secondary onPress={() => setEditorMode("closed")}>Cancel</Button>
                </View>
              </>
            ) : view === "health-events" ? (
              <>
                <FormField label="Kind">
                  <View style={styles.pickerField}>
                    <Picker accessibilityLabel="Kind" selectedValue={healthEventDraft.kind} style={styles.picker} onValueChange={(value) => setHealthEventDraft((current) => ({ ...current, kind: value as CreateHealthEventInput["kind"] }))}>
                      {healthEventKindCodes.map((kind) => <Picker.Item key={kind} label={healthEventKindLabels[kind]} value={kind} />)}
                    </Picker>
                  </View>
                </FormField>
                <FormField label="Status">
                  <View style={styles.pickerField}>
                    <Picker accessibilityLabel="Status" selectedValue={healthEventDraft.status} style={styles.picker} onValueChange={(value) => setHealthEventDraft((current) => ({ ...current, status: value as CreateHealthEventInput["status"] }))}>
                      <Picker.Item label="Completed" value="completed" />
                      <Picker.Item label="Entered in error" value="entered-in-error" />
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
            ) : (
              <>
                <FormField label="Title">
                  <TextInput accessibilityLabel="Title" placeholder="What needs care?" placeholderTextColor={colors.muted} style={styles.input} value={careItemDraft.title} onChangeText={(value) => setCareItemDraft((current) => ({ ...current, title: value }))} />
                </FormField>
                <FormField label="Kind">
                  <View style={styles.pickerField}>
                    <Picker accessibilityLabel="Kind" selectedValue={careItemDraft.kind} style={styles.picker} onValueChange={(value) => setCareItemDraft((current) => ({ ...current, kind: value as CreateCareItemInput["kind"] }))}>
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
                        <Picker.Item label="Skipped" value="skipped" />
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
            {editorMode !== "complete" ? <View style={styles.actions}><Button disabled={busy} onPress={() => { void save(); }}>{busy ? "Saving…" : "Save"}</Button><Button disabled={busy} secondary onPress={() => setEditorMode("closed")}>Cancel</Button></View> : null}
          </Card>
        ) : null}
      </ScrollView>
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
  content: { gap: spacing.md, paddingBottom: spacing.xl },
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
