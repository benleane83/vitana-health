import { useEffect, useState } from "react";
import type {
  CareItem,
  CareItemListQuery,
  CreateCareItemInput,
  CreateHealthEventInput,
  HealthEvent,
  HealthEventListQuery
} from "@local-fitness-advisor/shared";
import { api, ApiError } from "../../api.js";
import type { CareView } from "../../types.js";

type RemoteState<T> = { data?: T; busy: boolean; error?: string };
type ConfirmAction = (title: string, description: string, confirmLabel: string, destructive: boolean) => Promise<boolean>;

type HealthEventDraft = CreateHealthEventInput;
type CareItemDraft = CreateCareItemInput;

const defaultHealthEventDraft: HealthEventDraft = {
  kind: "other",
  status: "completed",
  occurredAt: new Date().toISOString(),
  provider: "",
  notes: ""
};

const defaultCareItemDraft: CareItemDraft = {
  title: "",
  kind: "Follow-up",
  priority: "normal",
  status: "open",
  dueStart: undefined,
  dueEnd: undefined,
  reminderAt: undefined,
  notes: "",
  originatingHealthEventId: undefined,
  completedHealthEventId: undefined
};

export function CareRoute({
  view,
  activeProfileId,
  onViewChange,
  onDataChanged,
  onNotice,
  confirm
}: {
  view: CareView;
  activeProfileId?: string;
  onViewChange: (view: CareView) => void;
  onDataChanged: () => Promise<void>;
  onNotice: (message: string) => void;
  confirm: ConfirmAction;
}) {
  const [healthEvents, setHealthEvents] = useState<RemoteState<Awaited<ReturnType<typeof api.care.listHealthEvents>>>>({ busy: true });
  const [careItems, setCareItems] = useState<RemoteState<Awaited<ReturnType<typeof api.care.listCareItems>>>>({ busy: true });
  const [healthEventFilters, setHealthEventFilters] = useState<HealthEventListQuery>({ limit: 20, offset: 0 });
  const [careItemFilters, setCareItemFilters] = useState<CareItemListQuery>({ limit: 20, offset: 0, status: "open" });
  const [healthEventDraft, setHealthEventDraft] = useState<HealthEventDraft>(defaultHealthEventDraft);
  const [careItemDraft, setCareItemDraft] = useState<CareItemDraft>(defaultCareItemDraft);
  const [editingHealthEventId, setEditingHealthEventId] = useState<string>();
  const [editingCareItemId, setEditingCareItemId] = useState<string>();
  const [actionBusy, setActionBusy] = useState(false);
  const [eventPickerSearch, setEventPickerSearch] = useState("");
  const [eventPickerOptions, setEventPickerOptions] = useState<HealthEvent[]>([]);

  useEffect(() => {
    if (view === "health-events") {
      void loadHealthEvents(true);
      return;
    }
    void loadCareItems(true);
  }, [view, activeProfileId]);

  useEffect(() => {
    if (view !== "items" || !editingCareItemId) return;
    let cancelled = false;
    void api.care.listHealthEvents({
      limit: 20,
      search: eventPickerSearch || undefined,
      includeId: careItemDraft.originatingHealthEventId ?? careItemDraft.completedHealthEventId
    }).then((response) => {
      if (!cancelled) setEventPickerOptions(response.items);
    }).catch(() => {
      if (!cancelled) setEventPickerOptions([]);
    });
    return () => { cancelled = true; };
  }, [view, editingCareItemId, careItemDraft.originatingHealthEventId, careItemDraft.completedHealthEventId, eventPickerSearch]);

  async function loadHealthEvents(reset = false) {
    const query = {
      ...healthEventFilters,
      offset: reset ? 0 : healthEventFilters.offset ?? 0,
      limit: healthEventFilters.limit ?? 20
    };
    setHealthEvents((current) => ({ ...current, busy: true, error: undefined }));
    try {
      const next = await api.care.listHealthEvents(query);
      setHealthEvents((current) => ({
        busy: false,
        data: !reset && current.data ? {
          ...next,
          items: [...current.data.items, ...next.items.filter((entry) => !current.data?.items.some((existing) => existing.id === entry.id))]
        } : next
      }));
    } catch (error) {
      setHealthEvents({ busy: false, error: error instanceof Error ? error.message : "Unable to load health events." });
    }
  }

  async function loadCareItems(reset = false) {
    const query = {
      ...careItemFilters,
      offset: reset ? 0 : careItemFilters.offset ?? 0,
      limit: careItemFilters.limit ?? 20
    };
    setCareItems((current) => ({ ...current, busy: true, error: undefined }));
    try {
      const next = await api.care.listCareItems(query);
      setCareItems((current) => ({
        busy: false,
        data: !reset && current.data ? {
          ...next,
          items: [...current.data.items, ...next.items.filter((entry) => !current.data?.items.some((existing) => existing.id === entry.id))]
        } : next
      }));
    } catch (error) {
      setCareItems({ busy: false, error: error instanceof Error ? error.message : "Unable to load care items." });
    }
  }

  function beginCreate() {
    if (view === "health-events") {
      setEditingHealthEventId("new");
      setHealthEventDraft(defaultHealthEventDraft);
      return;
    }
    setEditingCareItemId("new");
    setCareItemDraft(defaultCareItemDraft);
    setEventPickerSearch("");
  }

  function beginEditHealthEvent(entry: HealthEvent) {
    setEditingHealthEventId(entry.id);
    setHealthEventDraft({
      kind: entry.kind,
      status: entry.status,
      occurredAt: entry.occurredAt,
      occurredEnd: entry.occurredEnd,
      provider: entry.provider ?? "",
      notes: entry.notes ?? ""
    });
  }

  function beginEditCareItem(entry: CareItem) {
    setEditingCareItemId(entry.id);
    setCareItemDraft({
      title: entry.title,
      kind: entry.kind,
      dueStart: entry.dueStart,
      dueEnd: entry.dueEnd,
      reminderAt: entry.reminderAt,
      priority: entry.priority,
      status: entry.status,
      notes: entry.notes ?? "",
      originatingHealthEventId: entry.originatingHealthEventId,
      completedHealthEventId: entry.completedHealthEventId
    });
    setEventPickerSearch("");
  }

  async function saveHealthEvent() {
    await runAction(async () => {
      const payload = normalizeHealthEventDraft(healthEventDraft);
      if (editingHealthEventId && editingHealthEventId !== "new") {
        await api.care.updateHealthEvent(editingHealthEventId, payload);
        onNotice("Health event updated.");
      } else {
        await api.care.createHealthEvent(payload);
        onNotice("Health event added.");
      }
      await Promise.all([loadHealthEvents(true), onDataChanged()]);
      setEditingHealthEventId(undefined);
      setHealthEventDraft(defaultHealthEventDraft);
    });
  }

  async function saveCareItem() {
    await runAction(async () => {
      const payload = normalizeCareItemDraft(careItemDraft);
      if (editingCareItemId && editingCareItemId !== "new") {
        await api.care.updateCareItem(editingCareItemId, payload);
        onNotice("Care item updated.");
      } else {
        await api.care.createCareItem(payload);
        onNotice("Care item added.");
      }
      await Promise.all([loadCareItems(true), onDataChanged()]);
      setEditingCareItemId(undefined);
      setCareItemDraft(defaultCareItemDraft);
    });
  }

  async function deleteHealthEvent(entry: HealthEvent) {
    const approved = await confirm("Delete health event", `Delete the ${entry.kind} event recorded ${formatWhen(entry.occurredAt)}?`, "Delete", true);
    if (!approved) return;
    await runAction(async () => {
      try {
        await api.care.deleteHealthEvent(entry.id);
        await Promise.all([loadHealthEvents(true), onDataChanged()]);
        onNotice("Health event deleted.");
      } catch (error) {
        if (error instanceof ApiError && error.code === "CARE_HEALTH_EVENT_LINK_CONFLICT") {
          const linked = Array.isArray(error.details) ? error.details as Array<{ title?: string }> : [];
          onNotice(`Remove care links before deleting this health event${linked.length ? ` (${linked.map((item) => item.title).filter(Boolean).join(", ")})` : ""}.`);
          return;
        }
        throw error;
      }
    });
  }

  async function deleteCareItem(entry: CareItem) {
    const approved = await confirm("Delete care item", `Delete ${entry.title}?`, "Delete", true);
    if (!approved) return;
    await runAction(async () => {
      await api.care.deleteCareItem(entry.id);
      await Promise.all([loadCareItems(true), onDataChanged()]);
      onNotice("Care item deleted.");
    });
  }

  async function runAction(task: () => Promise<void>) {
    setActionBusy(true);
    try {
      await task();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unexpected care workflow error.");
    } finally {
      setActionBusy(false);
    }
  }

  const listBusy = view === "health-events" ? healthEvents.busy : careItems.busy;
  const listError = view === "health-events" ? healthEvents.error : careItems.error;
  const healthEventList = healthEvents.data?.items ?? [];
  const careItemList = careItems.data?.items ?? [];
  const canLoadMore = view === "health-events" ? !!healthEvents.data?.hasMore : !!careItems.data?.hasMore;

  return (
    <section className="panel care-panel">
      <div className="care-header">
        <div>
          <p className="eyebrow">Care records</p>
          <h1>Care</h1>
          <p className="care-subtitle">Track care items and profile-scoped health events without loading the full care collection.</p>
        </div>
        <button type="button" onClick={beginCreate}>{view === "health-events" ? "Add health event" : "Add care item"}</button>
      </div>
      <div className="care-switch" role="tablist" aria-label="Care views">
        {(["items", "health-events"] as const).map((value) => (
          <button key={value} role="tab" aria-selected={view === value} className={view === value ? "active" : ""} onClick={() => onViewChange(value)}>
            {value === "items" ? "Care items" : "Health events"}
          </button>
        ))}
      </div>
      <div className="care-layout">
        <div className="care-list-panel">
          {view === "health-events" ? (
            <HealthEventFilters filters={healthEventFilters} onChange={(next) => setHealthEventFilters((current) => ({ ...current, ...next, offset: 0 }))} onApply={() => { void loadHealthEvents(true); }} />
          ) : (
            <CareItemFilters filters={careItemFilters} onChange={(next) => setCareItemFilters((current) => ({ ...current, ...next, offset: 0 }))} onApply={() => { void loadCareItems(true); }} />
          )}
          <div aria-live="polite" aria-atomic="true">
            {listBusy ? <p className="empty" role="status">Loading {view === "health-events" ? "health events" : "care items"}…</p> : null}
            {listError ? <p className="empty" role="alert">{listError}</p> : null}
          </div>
          {view === "health-events" ? (
            <div className="care-results">
              {healthEventList.map((entry) => (
                <article className="care-row" key={entry.id}>
                  <div>
                    <strong>{humanizeKind(entry.kind)}</strong>
                    <p>{formatWhen(entry.occurredAt)}{entry.provider ? ` • ${entry.provider}` : ""}</p>
                    <p>{entry.status}{entry.notes ? ` • ${entry.notes.slice(0, 120)}` : ""}</p>
                  </div>
                  <div className="care-row-actions"><button type="button" onClick={() => beginEditHealthEvent(entry)}>Edit</button><button type="button" onClick={() => { void deleteHealthEvent(entry); }}>Delete</button></div>
                </article>
              ))}
              {!healthEventList.length && !listBusy ? <p className="empty">No health events matched these filters.</p> : null}
            </div>
          ) : (
            <div className="care-results">
              {careItemList.map((entry) => (
                <article className="care-row" key={entry.id}>
                  <div>
                    <strong>{entry.title}</strong>
                    <p>{entry.status} • {entry.priority} • {entry.kind}</p>
                    <p>{entry.dueStart ? `Due ${formatWhen(entry.dueStart)}` : "No due time"}{entry.originatingHealthEventId ? ` • Origin ${entry.originatingHealthEventId}` : ""}{entry.completedHealthEventId ? ` • Completion ${entry.completedHealthEventId}` : ""}</p>
                  </div>
                  <div className="care-row-actions"><button type="button" onClick={() => beginEditCareItem(entry)}>Edit</button><button type="button" onClick={() => { void deleteCareItem(entry); }}>Delete</button></div>
                </article>
              ))}
              {!careItemList.length && !listBusy ? <p className="empty">No care items matched these filters.</p> : null}
            </div>
          )}
          {canLoadMore ? (
            <button type="button" onClick={() => {
              if (view === "health-events") {
                setHealthEventFilters((current) => ({ ...current, offset: healthEventList.length }));
                void loadHealthEvents();
                return;
              }
              setCareItemFilters((current) => ({ ...current, offset: careItemList.length }));
              void loadCareItems();
            }}>Load more</button>
          ) : null}
        </div>
        <div className="care-editor-panel">
          {view === "health-events" && editingHealthEventId ? (
            <HealthEventEditor draft={healthEventDraft} busy={actionBusy} onChange={setHealthEventDraft} onCancel={() => setEditingHealthEventId(undefined)} onSave={() => { void saveHealthEvent(); }} />
          ) : null}
          {view === "items" && editingCareItemId ? (
            <CareItemEditor draft={careItemDraft} busy={actionBusy} eventSearch={eventPickerSearch} eventOptions={eventPickerOptions} onChange={setCareItemDraft} onEventSearchChange={setEventPickerSearch} onCancel={() => setEditingCareItemId(undefined)} onSave={() => { void saveCareItem(); }} />
          ) : null}
          {!editingHealthEventId && !editingCareItemId ? <p className="empty">Select a record to edit it, or add a new one.</p> : null}
        </div>
      </div>
    </section>
  );
}

function HealthEventFilters({ filters, onChange, onApply }: { filters: HealthEventListQuery; onChange: (next: Partial<HealthEventListQuery>) => void; onApply: () => void; }) {
  return <div className="care-filters"><input aria-label="Search health events" placeholder="Search health events" value={filters.search ?? ""} onChange={(event) => onChange({ search: event.target.value })} /><select aria-label="Filter health event kind" value={filters.kind ?? ""} onChange={(event) => onChange({ kind: (event.target.value || undefined) as HealthEventListQuery["kind"] })}><option value="">All kinds</option><option value="immunization">Immunization</option><option value="medication-administration">Medication administration</option><option value="other">Other</option></select><select aria-label="Filter health event status" value={filters.status ?? ""} onChange={(event) => onChange({ status: (event.target.value || undefined) as HealthEventListQuery["status"] })}><option value="">All statuses</option><option value="completed">Completed</option><option value="entered-in-error">Entered in error</option></select><button type="button" onClick={onApply}>Apply</button></div>;
}

function CareItemFilters({ filters, onChange, onApply }: { filters: CareItemListQuery; onChange: (next: Partial<CareItemListQuery>) => void; onApply: () => void; }) {
  return <div className="care-filters"><input aria-label="Search care items" placeholder="Search care items" value={filters.search ?? ""} onChange={(event) => onChange({ search: event.target.value })} /><select aria-label="Filter care item status" value={filters.status ?? ""} onChange={(event) => onChange({ status: (event.target.value || undefined) as CareItemListQuery["status"] })}><option value="">All statuses</option><option value="open">Open</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="skipped">Skipped</option></select><select aria-label="Filter care item priority" value={filters.priority ?? ""} onChange={(event) => onChange({ priority: (event.target.value || undefined) as CareItemListQuery["priority"] })}><option value="">All priorities</option><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select><button type="button" onClick={onApply}>Apply</button></div>;
}

function HealthEventEditor({ draft, busy, onChange, onCancel, onSave }: { draft: HealthEventDraft; busy: boolean; onChange: (next: HealthEventDraft) => void; onCancel: () => void; onSave: () => void; }) {
  return <form className="care-editor" onSubmit={(event) => { event.preventDefault(); onSave(); }}><h2>{draft.kind === "other" ? "Health event" : humanizeKind(draft.kind)}</h2><label>Kind<select value={draft.kind} onChange={(event) => onChange({ ...draft, kind: event.target.value as HealthEventDraft["kind"] })}><option value="immunization">Immunization</option><option value="medication-administration">Medication administration</option><option value="other">Other</option></select></label><label>Status<select value={draft.status} onChange={(event) => onChange({ ...draft, status: event.target.value as HealthEventDraft["status"] })}><option value="completed">Completed</option><option value="entered-in-error">Entered in error</option></select></label><label>Occurred start<input type="datetime-local" value={toDateTimeLocal(draft.occurredAt)} onChange={(event) => onChange({ ...draft, occurredAt: fromDateTimeLocal(event.target.value) || draft.occurredAt })} /></label><label>Occurred end<input type="datetime-local" value={toDateTimeLocal(draft.occurredEnd)} onChange={(event) => onChange({ ...draft, occurredEnd: fromDateTimeLocal(event.target.value) || undefined })} /></label><label>Provider<input value={draft.provider ?? ""} maxLength={160} onChange={(event) => onChange({ ...draft, provider: event.target.value })} /></label><label>Notes<textarea value={draft.notes ?? ""} maxLength={4000} onChange={(event) => onChange({ ...draft, notes: event.target.value })} /></label><div className="care-editor-actions"><button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button><button type="button" onClick={onCancel}>Cancel</button></div></form>;
}

function CareItemEditor({ draft, busy, eventSearch, eventOptions, onChange, onEventSearchChange, onCancel, onSave }: { draft: CareItemDraft; busy: boolean; eventSearch: string; eventOptions: HealthEvent[]; onChange: (next: CareItemDraft) => void; onEventSearchChange: (value: string) => void; onCancel: () => void; onSave: () => void; }) {
  return <form className="care-editor" onSubmit={(event) => { event.preventDefault(); onSave(); }}><h2>{draft.title || "Care item"}</h2><label>Title<input value={draft.title} maxLength={160} onChange={(event) => onChange({ ...draft, title: event.target.value })} /></label><label>Kind<input value={draft.kind} maxLength={80} onChange={(event) => onChange({ ...draft, kind: event.target.value })} /></label><label>Status<select value={draft.status} onChange={(event) => onChange({ ...draft, status: event.target.value as CareItemDraft["status"] })}><option value="open">Open</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="skipped">Skipped</option></select></label><label>Priority<select value={draft.priority} onChange={(event) => onChange({ ...draft, priority: event.target.value as CareItemDraft["priority"] })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label><label>Due start<input type="datetime-local" value={toDateTimeLocal(draft.dueStart)} onChange={(event) => onChange({ ...draft, dueStart: fromDateTimeLocal(event.target.value) || undefined })} /></label><label>Due end<input type="datetime-local" value={toDateTimeLocal(draft.dueEnd)} onChange={(event) => onChange({ ...draft, dueEnd: fromDateTimeLocal(event.target.value) || undefined })} /></label><label>Reminder<input type="datetime-local" value={toDateTimeLocal(draft.reminderAt)} onChange={(event) => onChange({ ...draft, reminderAt: fromDateTimeLocal(event.target.value) || undefined })} /></label><label>Search linked events<input value={eventSearch} onChange={(event) => onEventSearchChange(event.target.value)} placeholder="Search events" /></label><label>Originating event<select value={draft.originatingHealthEventId ?? ""} onChange={(event) => onChange({ ...draft, originatingHealthEventId: event.target.value || undefined })}><option value="">None</option>{eventOptions.map((entry) => <option key={`origin-${entry.id}`} value={entry.id}>{humanizeKind(entry.kind)} • {formatWhen(entry.occurredAt)}</option>)}</select></label><label>Completion event<select value={draft.completedHealthEventId ?? ""} onChange={(event) => onChange({ ...draft, completedHealthEventId: event.target.value || undefined })}><option value="">None</option>{eventOptions.map((entry) => <option key={`completion-${entry.id}`} value={entry.id}>{humanizeKind(entry.kind)} • {formatWhen(entry.occurredAt)}</option>)}</select></label><label>Notes<textarea value={draft.notes ?? ""} maxLength={4000} onChange={(event) => onChange({ ...draft, notes: event.target.value })} /></label><div className="care-editor-actions"><button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button><button type="button" onClick={onCancel}>Cancel</button></div></form>;
}

function toDateTimeLocal(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (segment: number) => String(segment).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDateTimeLocal(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function humanizeKind(value: string): string {
  return value.replaceAll("-", " ").replace(/\b\w/g, (segment) => segment.toUpperCase());
}

function formatWhen(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Date unavailable";
}

function normalizeHealthEventDraft(draft: HealthEventDraft): CreateHealthEventInput {
  return { kind: draft.kind, status: draft.status, occurredAt: draft.occurredAt, occurredEnd: draft.occurredEnd || undefined, provider: draft.provider?.trim() || undefined, notes: draft.notes?.trim() || undefined };
}

function normalizeCareItemDraft(draft: CareItemDraft): CreateCareItemInput {
  return { title: draft.title.trim(), kind: draft.kind.trim(), dueStart: draft.dueStart || undefined, dueEnd: draft.dueEnd || undefined, reminderAt: draft.reminderAt || undefined, priority: draft.priority, status: draft.status, notes: draft.notes?.trim() || undefined, originatingHealthEventId: draft.originatingHealthEventId || undefined, completedHealthEventId: draft.completedHealthEventId || undefined };
}
