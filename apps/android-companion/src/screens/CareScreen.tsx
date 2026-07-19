import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Picker } from "@react-native-picker/picker";
import {
  careItemKindCodes,
  careItemKindLabels,
  careItemReminderAt,
  careItemReminderLead,
  careItemReminderLeadCodes,
  careItemReminderLeadLabels,
  healthEventKindCodes,
  healthEventKindLabels,
  isCareItemKind,
  normalizedCareItemKind,
  type CareItem,
  type CareItemReminderLead,
  type CreateCareItemInput,
  type CreateHealthEventInput,
  type HealthEvent
} from "@local-fitness-advisor/shared";
import { useFocusEffect } from "@react-navigation/native";
import { useMobileApi } from "../MobileApiProvider";
import { Button, Card, Message, Screen } from "../ui/components";
import { colors, spacing } from "../ui/theme";

type CareView = "items" | "health-events";
type ReminderSelection = "" | CareItemReminderLead | "existing";

const defaultHealthEvent: CreateHealthEventInput = {
  kind: "other",
  status: "completed",
  occurredAt: new Date().toISOString(),
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
    deleteCareItem,
    createHealthEvent,
    updateHealthEvent,
    deleteHealthEvent
  } = useMobileApi();
  const [view, setView] = useState<CareView>("items");
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<CareItem[]>([]);
  const [events, setEvents] = useState<HealthEvent[]>([]);
  const [pickerEvents, setPickerEvents] = useState<HealthEvent[]>([]);
  const [editorMode, setEditorMode] = useState<"closed" | "create" | "edit">("closed");
  const [editingId, setEditingId] = useState<string>();
  const [healthEventDraft, setHealthEventDraft] = useState<CreateHealthEventInput>(defaultHealthEvent);
  const [careItemDraft, setCareItemDraft] = useState<CreateCareItemInput>(defaultCareItem);
  const [reminderSelection, setReminderSelection] = useState<ReminderSelection>("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  const load = useCallback(async () => {
    if (standaloneMode) {
      setItems([]);
      setEvents([]);
      setPickerEvents([]);
      setLoading(false);
      setMessage(undefined);
      return;
    }
    setLoading(true);
    try {
      const [nextItems, nextEvents] = await Promise.all([
        listCareItems({ limit: 30, status: view === "items" ? "open" : undefined }),
        listHealthEvents({ limit: 30 })
      ]);
      setItems(nextItems.items);
      setEvents(nextEvents.items);
      setPickerEvents(nextEvents.items);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Unable to load care data.");
    } finally {
      setLoading(false);
    }
  }, [listCareItems, listHealthEvents, standaloneMode, view]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  useEffect(() => {
    if (standaloneMode || view !== "items" || editorMode === "closed") return;
    let current = true;
    void listHealthEvents({ limit: 100, includeId: careItemDraft.originatingHealthEventId ?? careItemDraft.completedHealthEventId }).then((response) => {
      if (current) setPickerEvents(response.items);
    }).catch(() => undefined);
    return () => { current = false; };
  }, [careItemDraft.completedHealthEventId, careItemDraft.originatingHealthEventId, editorMode, listHealthEvents, standaloneMode, view]);

  async function save() {
    setBusy(true);
    try {
      if (view === "health-events") {
        const payload = normalizeHealthEvent(healthEventDraft);
        if (editorMode === "edit" && editingId) await updateHealthEvent(editingId, payload);
        else await createHealthEvent(payload);
      } else {
        const payload = normalizeCareItem(careItemDraft, reminderSelection);
        if (editorMode === "edit" && editingId) await updateCareItem(editingId, payload);
        else await createCareItem(payload);
      }
      setEditorMode("closed");
      setEditingId(undefined);
      setMessage(view === "health-events" ? "Health event saved." : "Care item saved.");
      await load();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Unable to save care data.");
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
      setMessage(caught instanceof Error ? caught.message : "Unable to delete care data.");
    } finally {
      setBusy(false);
    }
  }

  function startCreate() {
    setEditingId(undefined);
    setEditorMode("create");
    setHealthEventDraft(defaultHealthEvent);
    setCareItemDraft(defaultCareItem);
    setReminderSelection("");
  }

  function startEditHealthEvent(entry: HealthEvent) {
    setView("health-events");
    setEditingId(entry.id);
    setHealthEventDraft({ kind: entry.kind, status: entry.status, occurredAt: entry.occurredAt, occurredEnd: entry.occurredEnd, provider: entry.provider ?? "", notes: entry.notes ?? "" });
    setEditorMode("edit");
  }

  function startEditCareItem(entry: CareItem) {
    setView("items");
    setEditingId(entry.id);
    setCareItemDraft({ title: entry.title, kind: normalizedCareItemKind(entry.kind), dueStart: entry.dueStart, dueEnd: entry.dueEnd, reminderAt: entry.reminderAt, priority: entry.priority, status: entry.status, notes: entry.notes ?? "", originatingHealthEventId: entry.originatingHealthEventId, completedHealthEventId: entry.completedHealthEventId });
    setReminderSelection(careItemReminderLead(entry.dueStart, entry.reminderAt) ?? (entry.reminderAt ? "existing" : ""));
    setEditorMode("edit");
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
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { void load(); }} />}>
        <View style={styles.headerRow}>
          <View style={styles.segmented}>
            {(["items", "health-events"] as const).map((value) => (
              <Pressable key={value} onPress={() => setView(value)} style={[styles.segment, view === value && styles.segmentActive]}>
                <Text style={[styles.segmentText, view === value && styles.segmentTextActive]}>{value === "items" ? "Care items" : "Health events"}</Text>
              </Pressable>
            ))}
          </View>
          {!demoMode ? <Button disabled={busy} onPress={startCreate}>{view === "items" ? "Add care item" : "Add health event"}</Button> : null}
        </View>
        {demoMode ? <Message title="Demo mode is read-only" detail="Connect to your paired PC to create, edit, or delete care records." /> : null}
        {connectionState !== "online" ? <Message title={connectionState.replaceAll("-", " ")} detail={error ?? "Reconnect to refresh Care data."} tone="warning" /> : null}
        {message ? <Message title="Care" detail={message} /> : null}
        {view === "health-events" ? events.map((entry) => (
          <Card key={entry.id}>
            <Text style={styles.title}>{healthEventKindLabels[entry.kind]}</Text>
            <Text style={styles.meta}>{formatWhen(entry.occurredAt)}{entry.provider ? ` • ${entry.provider}` : ""}</Text>
            <Text style={styles.meta}>{entry.status}{entry.notes ? ` • ${entry.notes}` : ""}</Text>
            {!demoMode ? <View style={styles.actions}><Button secondary onPress={() => startEditHealthEvent(entry)}>Edit</Button><Button secondary onPress={() => { void remove(entry.id); }}>Delete</Button></View> : null}
          </Card>
        )) : items.map((entry) => (
          <Card key={entry.id}>
            <Text style={styles.title}>{entry.title}</Text>
            <Text style={styles.meta}>{entry.status} • {careItemKindLabel(entry.kind)}</Text>
            <Text style={styles.meta}>{entry.dueStart ? `Due ${formatWhen(entry.dueStart)}` : "No due time"}</Text>
            {!demoMode ? <View style={styles.actions}><Button secondary onPress={() => startEditCareItem(entry)}>Edit</Button><Button secondary onPress={() => { void remove(entry.id); }}>Delete</Button></View> : null}
          </Card>
        ))}
        {editorMode !== "closed" ? (
          <Card>
            <Text style={styles.heading}>{editorMode === "create" ? "New record" : "Edit record"}</Text>
            {view === "health-events" ? (
              <>
                <Text style={styles.label}>Kind</Text>
                <Picker selectedValue={healthEventDraft.kind} onValueChange={(value) => setHealthEventDraft((current) => ({ ...current, kind: value as CreateHealthEventInput["kind"] }))}>
                  {healthEventKindCodes.map((kind) => <Picker.Item key={kind} label={healthEventKindLabels[kind]} value={kind} />)}
                </Picker>
                <Text style={styles.label}>Status</Text>
                <Picker selectedValue={healthEventDraft.status} onValueChange={(value) => setHealthEventDraft((current) => ({ ...current, status: value as CreateHealthEventInput["status"] }))}>
                  <Picker.Item label="Completed" value="completed" />
                  <Picker.Item label="Entered in error" value="entered-in-error" />
                </Picker>
                <TextInput accessibilityLabel="Occurred at" style={styles.input} value={healthEventDraft.occurredAt} onChangeText={(value) => setHealthEventDraft((current) => ({ ...current, occurredAt: value }))} />
                <TextInput accessibilityLabel="Occurred end" style={styles.input} value={healthEventDraft.occurredEnd ?? ""} onChangeText={(value) => setHealthEventDraft((current) => ({ ...current, occurredEnd: value || undefined }))} />
                <TextInput accessibilityLabel="Provider" style={styles.input} value={healthEventDraft.provider ?? ""} onChangeText={(value) => setHealthEventDraft((current) => ({ ...current, provider: value }))} />
                <TextInput accessibilityLabel="Notes" multiline style={styles.input} value={healthEventDraft.notes ?? ""} onChangeText={(value) => setHealthEventDraft((current) => ({ ...current, notes: value }))} />
              </>
            ) : (
              <>
                <TextInput accessibilityLabel="Title" style={styles.input} value={careItemDraft.title} onChangeText={(value) => setCareItemDraft((current) => ({ ...current, title: value }))} />
                <Text style={styles.label}>Kind</Text>
                <Picker selectedValue={careItemDraft.kind} onValueChange={(value) => setCareItemDraft((current) => ({ ...current, kind: value as CreateCareItemInput["kind"] }))}>
                  {careItemKindCodes.map((kind) => <Picker.Item key={kind} label={careItemKindLabels[kind]} value={kind} />)}
                </Picker>
                <Text style={styles.label}>Status</Text>
                <Picker selectedValue={careItemDraft.status} onValueChange={(value) => setCareItemDraft((current) => ({ ...current, status: value as CreateCareItemInput["status"] }))}>
                  <Picker.Item label="Open" value="open" />
                  <Picker.Item label="Completed" value="completed" />
                  <Picker.Item label="Cancelled" value="cancelled" />
                  <Picker.Item label="Skipped" value="skipped" />
                </Picker>
                <TextInput accessibilityLabel="Due start" style={styles.input} value={careItemDraft.dueStart ?? ""} onChangeText={(value) => {
                  setCareItemDraft((current) => ({ ...current, dueStart: value || undefined }));
                  if (reminderSelection === "existing") setReminderSelection("");
                }} />
                <TextInput accessibilityLabel="Due end" style={styles.input} value={careItemDraft.dueEnd ?? ""} onChangeText={(value) => setCareItemDraft((current) => ({ ...current, dueEnd: value || undefined }))} />
                <Text style={styles.label}>Reminder</Text>
                <Picker selectedValue={reminderSelection} enabled={!!careItemDraft.dueStart || reminderSelection === "existing"} onValueChange={(value) => setReminderSelection(value as ReminderSelection)}>
                  <Picker.Item label="No reminder" value="" />
                  {careItemReminderLeadCodes.map((lead) => <Picker.Item key={lead} label={careItemReminderLeadLabels[lead]} value={lead} />)}
                  {reminderSelection === "existing" ? <Picker.Item label={`Existing reminder (${formatWhen(careItemDraft.reminderAt!)})`} value="existing" /> : null}
                </Picker>
                <Text style={styles.label}>Originating event</Text>
                <Picker selectedValue={careItemDraft.originatingHealthEventId ?? ""} onValueChange={(value) => setCareItemDraft((current) => ({ ...current, originatingHealthEventId: value || undefined }))}>
                  <Picker.Item label="None" value="" />
                  {pickerEvents.map((entry) => <Picker.Item key={`origin-${entry.id}`} label={`${healthEventKindLabels[entry.kind]} • ${formatWhen(entry.occurredAt)}`} value={entry.id} />)}
                </Picker>
                <Text style={styles.label}>Completion event</Text>
                <Picker selectedValue={careItemDraft.completedHealthEventId ?? ""} onValueChange={(value) => setCareItemDraft((current) => ({ ...current, completedHealthEventId: value || undefined }))}>
                  <Picker.Item label="None" value="" />
                  {pickerEvents.map((entry) => <Picker.Item key={`completion-${entry.id}`} label={`${healthEventKindLabels[entry.kind]} • ${formatWhen(entry.occurredAt)}`} value={entry.id} />)}
                </Picker>
                <TextInput accessibilityLabel="Notes" multiline style={styles.input} value={careItemDraft.notes ?? ""} onChangeText={(value) => setCareItemDraft((current) => ({ ...current, notes: value }))} />
              </>
            )}
            <View style={styles.actions}><Button disabled={busy} onPress={() => { void save(); }}>{busy ? "Saving…" : "Save"}</Button><Button secondary onPress={() => setEditorMode("closed")}>Cancel</Button></View>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function normalizeHealthEvent(draft: CreateHealthEventInput): CreateHealthEventInput {
  return { ...draft, provider: draft.provider?.trim() || undefined, notes: draft.notes?.trim() || undefined };
}

function normalizeCareItem(draft: CreateCareItemInput, reminderSelection: ReminderSelection): CreateCareItemInput {
  const reminderAt = reminderSelection === "existing"
    ? draft.reminderAt
    : reminderSelection
      ? careItemReminderAt(draft.dueStart, reminderSelection)
      : undefined;
  return { ...draft, title: draft.title.trim(), reminderAt, notes: draft.notes?.trim() || undefined, originatingHealthEventId: draft.originatingHealthEventId || undefined, completedHealthEventId: draft.completedHealthEventId || undefined };
}

function careItemKindLabel(kind: string): string {
  if (isCareItemKind(kind)) return careItemKindLabels[kind];
  return kind;
}

function formatWhen(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  headerRow: { gap: spacing.md },
  segmented: { flexDirection: "row", gap: spacing.sm },
  segment: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 999, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  segmentActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  segmentText: { color: colors.text, fontWeight: "700" },
  segmentTextActive: { color: colors.onAccent },
  title: { color: colors.text, fontSize: 17, fontWeight: "700" },
  heading: { color: colors.text, fontSize: 18, fontWeight: "800" },
  label: { color: colors.muted, fontSize: 14, fontWeight: "700" },
  meta: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  input: { backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: 10, borderWidth: 1, color: colors.text, minHeight: 48, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }
});
