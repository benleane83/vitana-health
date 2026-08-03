import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ArrowLeft, CalendarPlus, History, SearchX } from "lucide-react";
import {
  careItemKindCodes,
  careItemKindLabels,
  careItemReminderAt,
  careItemReminderLeadLabels,
  defaultHealthEventKindForCareItem,
  healthEventKindCodes,
  healthEventKindLabels,
  isCareItemKind,
  normalizedCareItemKind
} from "@vitana/shared";
import type {
  CareItem,
  CareItemListQuery,
  CareItemReminderLead,
  CompleteCareItemInput,
  CreateCareItemInput,
  CreateHealthEventInput,
  HealthEvent,
  HealthEventListQuery
} from "@vitana/shared";
import { api, ApiError } from "../../api.js";
import type { CareView } from "../../types.js";

type RemoteState<T> = { data?: T; busy: boolean; error?: string };
type ConfirmAction = (title: string, description: string, confirmLabel: string, destructive: boolean) => Promise<boolean>;

type HealthEventDraft = CreateHealthEventInput;
type CareItemDraft = CreateCareItemInput;
type CompletionDraft = CompleteCareItemInput;

const defaultHealthEventDraft: HealthEventDraft = {
  kind: "other",
  status: "completed",
  occurredAt: dateOnlyIso(new Date()),
  provider: "",
  notes: ""
};

const defaultCareItemDraft: CareItemDraft = {
  title: "",
  kind: "follow-up",
  priority: "normal",
  status: "open",
  reminderAt: undefined,
  notes: ""
};

export function CareRoute({
  view,
  activeProfileId,
  selectedCareItemId,
  onViewChange,
  onDataChanged,
  onNotice,
  confirm
}: {
  view: CareView;
  activeProfileId?: string;
  selectedCareItemId?: string;
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
  const [completingCareItem, setCompletingCareItem] = useState<CareItem>();
  const [completionDraft, setCompletionDraft] = useState<CompletionDraft>(() => ({
    occurredAt: dateOnlyIso(new Date()),
    kind: defaultHealthEventKindForCareItem[defaultCareItemDraft.kind]
  }));
  const [actionBusy, setActionBusy] = useState(false);
  const listPanelRef = useRef<HTMLDivElement>(null);
  const editorPanelRef = useRef<HTMLDivElement>(null);

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, currentView: CareView) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextView: CareView = event.key === "ArrowRight" || event.key === "End" ? "health-events" : "items";
    const resolvedView = event.key.startsWith("Arrow") && nextView === currentView
      ? currentView === "items" ? "health-events" : "items"
      : nextView;
    onViewChange(resolvedView);
    document.getElementById(`care-tab-${resolvedView}`)?.focus();
  }

  useEffect(() => {
    if (view === "health-events") {
      void loadHealthEvents(true);
      return;
    }
    void loadCareItems(true);
  }, [view, activeProfileId, selectedCareItemId]);

  const editorActive = Boolean(editingHealthEventId || editingCareItemId || completingCareItem);

  useEffect(() => {
    if (!editorActive || typeof window.matchMedia !== "function" || !window.matchMedia("(max-width: 900px)").matches) return;
    requestAnimationFrame(() => {
      editorPanelRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      editorPanelRef.current?.querySelector<HTMLElement>("h2")?.focus();
    });
  }, [editorActive]);

  function closeEditor() {
    setEditingHealthEventId(undefined);
    setEditingCareItemId(undefined);
    setCompletingCareItem(undefined);
    requestAnimationFrame(() => listPanelRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }

  async function loadHealthEvents(reset = false, filters = healthEventFilters) {
    const query = {
      ...filters,
      offset: reset ? 0 : filters.offset ?? 0,
      limit: filters.limit ?? 20
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

  async function loadCareItems(reset = false, filters = careItemFilters) {
    const query = {
      ...filters,
      offset: reset ? 0 : filters.offset ?? 0,
      limit: filters.limit ?? 20,
      includeId: selectedCareItemId
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
      if (reset && selectedCareItemId) {
        const selected = next.items.find((entry) => entry.id === selectedCareItemId);
        if (selected) beginEditCareItem(selected);
      }
    } catch (error) {
      setCareItems({ busy: false, error: error instanceof Error ? error.message : "Unable to load care items." });
    }
  }

  function beginCreate() {
    setCompletingCareItem(undefined);
    if (view === "health-events") {
      setEditingHealthEventId("new");
      setHealthEventDraft(defaultHealthEventDraft);
      return;
    }
    setEditingCareItemId("new");
    setCareItemDraft(defaultCareItemDraft);
  }

  function clearFilters() {
    if (view === "health-events") {
      const next: HealthEventListQuery = { limit: 20, offset: 0 };
      setHealthEventFilters(next);
      void loadHealthEvents(true, next);
      return;
    }
    const next: CareItemListQuery = { limit: 20, offset: 0, status: "open" };
    setCareItemFilters(next);
    void loadCareItems(true, next);
  }

  function showAllCareItems() {
    const next: CareItemListQuery = { limit: 20, offset: 0 };
    setCareItemFilters(next);
    void loadCareItems(true, next);
  }

  function beginEditHealthEvent(entry: HealthEvent) {
    setEditingHealthEventId(entry.id);
    setHealthEventDraft({
      kind: entry.kind,
      status: entry.status,
      occurredAt: entry.occurredAt,
      provider: entry.provider ?? "",
      notes: entry.notes ?? ""
    });
  }

  function beginEditCareItem(entry: CareItem) {
    setCompletingCareItem(undefined);
    setEditingCareItemId(entry.id);
    setCareItemDraft({
      title: entry.title,
      kind: normalizedCareItemKind(entry.kind),
      dueStart: entry.dueStart,
      reminderAt: entry.reminderAt,
      priority: entry.priority,
      status: entry.status,
      notes: entry.notes ?? ""
    });
  }

  function beginCompleteCareItem(entry: CareItem) {
    setEditingCareItemId(undefined);
    setCompletingCareItem(entry);
    setCompletionDraft({
      occurredAt: dateOnlyIso(new Date()),
      kind: defaultHealthEventKindForCareItem[normalizedCareItemKind(entry.kind)]
    });
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

  async function completeCareItem() {
    if (!completingCareItem) return;
    await runAction(async () => {
      await api.care.completeCareItem(completingCareItem.id, completionDraft);
      await Promise.all([loadCareItems(true), onDataChanged()]);
      onNotice(`${completingCareItem.title} completed and added to Health events.`);
      setCompletingCareItem(undefined);
    });
  }

  async function deleteHealthEvent(entry: HealthEvent) {
    const confirmed = await confirm("Delete health event", `Delete the ${entry.kind} event recorded ${formatWhen(entry.occurredAt)}?`, "Delete", true);
    if (!confirmed) return;
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
    const confirmed = await confirm("Delete care item", `Delete ${entry.title}?`, "Delete", true);
    if (!confirmed) return;
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
  const hasActiveFilters = view === "health-events"
    ? Boolean(healthEventFilters.search?.trim() || healthEventFilters.kind || healthEventFilters.status)
    : Boolean(careItemFilters.search?.trim() || careItemFilters.kind || (careItemFilters.status && careItemFilters.status !== "open"));
  const listEmpty = !listBusy && !listError && (view === "health-events" ? !healthEventList.length : !careItemList.length);
  const showEmptyState = listEmpty && !editorActive;

  return (
    <section className="panel care-panel">
      <div className="care-header">
        <div className="care-empty-copy">
          <h1>Care</h1>
          <p className="care-subtitle">Track care items and health events for the active profile.</p>
        </div>
        {!showEmptyState ? <button type="button" onClick={beginCreate}>{view === "health-events" ? "Add health event" : "Add care item"}</button> : null}
      </div>
      <div className="care-switch" role="tablist" aria-label="Care views">
        {(["items", "health-events"] as const).map((value) => (
          <button key={value} id={`care-tab-${value}`} role="tab" aria-selected={view === value} aria-controls="care-view-panel" tabIndex={view === value ? 0 : -1} className={view === value ? "active" : ""} onClick={() => onViewChange(value)} onKeyDown={(event) => handleTabKeyDown(event, value)}>
            {value === "items" ? "Care items" : "Health events"}
          </button>
        ))}
      </div>
      <p className="care-view-description">
        {view === "items"
          ? "Plan and track appointments, follow-ups, and other care that still needs attention."
          : "Record care, symptoms, tests, treatments, and other health moments that have already happened."}
      </p>
      <div id="care-view-panel" className={`care-layout${editorActive ? " has-editor" : ""}${showEmptyState ? " is-empty" : ""}`} role="tabpanel" aria-labelledby={`care-tab-${view}`}>
        <div className="care-list-panel" ref={listPanelRef}>
          {!showEmptyState || hasActiveFilters ? (
            view === "health-events" ? (
              <HealthEventFilters filters={healthEventFilters} onChange={(next) => setHealthEventFilters((current) => ({ ...current, ...next, offset: 0 }))} onApply={() => { void loadHealthEvents(true); }} />
            ) : (
              <CareItemFilters filters={careItemFilters} onChange={(next) => setCareItemFilters((current) => ({ ...current, ...next, offset: 0 }))} onApply={() => { void loadCareItems(true); }} />
            )
          ) : null}
          <div aria-live="polite" aria-atomic="true">
            {listBusy ? <p className="empty" role="status">Loading {view === "health-events" ? "health events" : "care items"}…</p> : null}
            {listError ? <p className="empty" role="alert">{listError}</p> : null}
          </div>
          {view === "health-events" ? (
            <div className="care-results">
              {healthEventList.map((entry) => (
                <article className="care-row" key={entry.id}>
                  <button
                    type="button"
                    className="care-row-content care-row-select"
                    aria-label={`Edit ${healthEventKindLabels[entry.kind]} recorded ${formatWhen(entry.occurredAt)}`}
                    aria-pressed={editingHealthEventId === entry.id}
                    onClick={() => beginEditHealthEvent(entry)}
                  >
                    <strong>{healthEventKindLabels[entry.kind]}</strong>
                    <span>{formatWhen(entry.occurredAt)}{entry.provider ? ` • ${entry.provider}` : ""}</span>
                    <span>{entry.status}{entry.notes ? ` • ${entry.notes.slice(0, 120)}` : ""}</span>
                  </button>
                  <CareRowActions
                    label={healthEventKindLabels[entry.kind]}
                    onEdit={() => beginEditHealthEvent(entry)}
                    onDelete={() => { void deleteHealthEvent(entry); }}
                  />
                </article>
              ))}
              {showEmptyState ? <CareEmptyState view={view} filtered={hasActiveFilters} onCreate={beginCreate} onClearFilters={clearFilters} /> : null}
            </div>
          ) : (
            <div className="care-results">
              {careItemList.map((entry) => (
                <article className="care-row" key={entry.id}>
                  <button
                    type="button"
                    className="care-row-content care-row-select"
                    aria-label={`Edit ${entry.title}`}
                    aria-pressed={editingCareItemId === entry.id}
                    onClick={() => beginEditCareItem(entry)}
                  >
                    <strong>{entry.title}</strong>
                    <span>{entry.status} • {careItemKindLabel(entry.kind)}</span>
                    <span>
                      {entry.dueStart ? `Due ${formatWhen(entry.dueStart)}` : "No due date"}
                      {entry.completedHealthEventId
                        ? ` • Completion: ${entry.completedHealthEvent ? formatEventReference(entry.completedHealthEvent) : "Linked event unavailable"}`
                        : ""}
                    </span>
                  </button>
                  <CareRowActions
                    label={entry.title}
                    primaryAction={entry.status === "open" ? { label: "Complete", onClick: () => beginCompleteCareItem(entry) } : undefined}
                    onEdit={() => beginEditCareItem(entry)}
                    onDelete={() => { void deleteCareItem(entry); }}
                  />
                </article>
              ))}
              {showEmptyState ? <CareEmptyState view={view} filtered={hasActiveFilters} canShowAll={careItemFilters.status === "open"} onCreate={beginCreate} onClearFilters={clearFilters} onShowAll={showAllCareItems} /> : null}
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
        <div className="care-editor-panel" ref={editorPanelRef}>
          {editorActive ? (
            <button type="button" className="care-editor-mobile-back" onClick={closeEditor}>
              <ArrowLeft aria-hidden="true" size={18} />
              Back to {view === "health-events" ? "health events" : "care items"}
            </button>
          ) : null}
          {view === "items" && completingCareItem ? (
            <CareItemCompletionEditor item={completingCareItem} draft={completionDraft} busy={actionBusy} onChange={setCompletionDraft} onCancel={() => setCompletingCareItem(undefined)} onComplete={() => { void completeCareItem(); }} />
          ) : null}
          {view === "health-events" && editingHealthEventId ? (
            <HealthEventEditor draft={healthEventDraft} busy={actionBusy} onChange={setHealthEventDraft} onCancel={() => setEditingHealthEventId(undefined)} onSave={() => { void saveHealthEvent(); }} />
          ) : null}
          {view === "items" && editingCareItemId ? (
            <CareItemEditor draft={careItemDraft} busy={actionBusy} onChange={setCareItemDraft} onCancel={() => setEditingCareItemId(undefined)} onSave={() => { void saveCareItem(); }} />
          ) : null}
          {!editorActive && !listEmpty ? <p className="empty">Select a record to edit it, or add a new one.</p> : null}
        </div>
      </div>
    </section>
  );
}

function CareEmptyState({
  view,
  filtered,
  canShowAll = false,
  onCreate,
  onClearFilters,
  onShowAll
}: {
  view: CareView;
  filtered: boolean;
  canShowAll?: boolean;
  onCreate: () => void;
  onClearFilters: () => void;
  onShowAll?: () => void;
}) {
  if (filtered) {
    return (
      <section className="care-empty-state" aria-labelledby="care-empty-title">
        <span className="care-empty-state-icon" aria-hidden="true"><SearchX size={24} /></span>
        <div>
          <h2 id="care-empty-title">No matches found</h2>
          <p>Try a different search, kind, or status, or return to the default view.</p>
        </div>
        <button type="button" className="care-empty-secondary" onClick={onClearFilters}>Clear filters</button>
      </section>
    );
  }

  const isHealthEvents = view === "health-events";
  return (
    <section className="care-empty-state" aria-labelledby="care-empty-title">
      <span className="care-empty-state-icon" aria-hidden="true">
        {isHealthEvents ? <History size={24} /> : <CalendarPlus size={24} />}
      </span>
      <div className="care-empty-copy">
        <h2 id="care-empty-title">{isHealthEvents ? "Build your health history" : "Nothing needs your attention"}</h2>
        <p>
          {isHealthEvents
            ? "Record visits, tests, treatments, symptoms, and other health moments as they happen."
            : "Add appointments, check-ups, or follow-ups with an optional due date and reminder. Completed care is recorded in Health events."}
        </p>
      </div>
      <div className="care-empty-actions">
        <button type="button" onClick={onCreate}>{isHealthEvents ? "Add health event" : "Add care item"}</button>
        {canShowAll && onShowAll ? <button type="button" className="care-empty-secondary" onClick={onShowAll}>View all statuses</button> : null}
      </div>
    </section>
  );
}

function CareRowActions({
  label,
  primaryAction,
  onEdit,
  onDelete
}: {
  label: string;
  primaryAction?: { label: string; onClick: () => void };
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="care-row-actions">
      {primaryAction ? <button type="button" onClick={primaryAction.onClick}>{primaryAction.label}</button> : null}
      <div className="care-row-menu" ref={menuRef}>
        <button
          type="button"
          className="care-row-menu-trigger"
          aria-label={`More actions for ${label}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <span aria-hidden="true">…</span>
        </button>
        {open ? (
          <div className="care-row-menu-popover" role="menu" aria-label={`Actions for ${label}`}>
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onEdit(); }}>Edit</button>
            <button type="button" role="menuitem" className="care-row-delete" onClick={() => { setOpen(false); onDelete(); }}>Delete</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function HealthEventFilters({ filters, onChange, onApply }: { filters: HealthEventListQuery; onChange: (next: Partial<HealthEventListQuery>) => void; onApply: () => void; }) {
  return <div className="care-filters"><input aria-label="Search health events" placeholder="Search health events" value={filters.search ?? ""} onChange={(event) => onChange({ search: event.target.value })} /><select aria-label="Filter health event kind" value={filters.kind ?? ""} onChange={(event) => onChange({ kind: (event.target.value || undefined) as HealthEventListQuery["kind"] })}><option value="">All kinds</option>{healthEventKindCodes.map((kind) => <option key={kind} value={kind}>{healthEventKindLabels[kind]}</option>)}</select><select aria-label="Filter health event status" value={filters.status ?? ""} onChange={(event) => onChange({ status: (event.target.value || undefined) as HealthEventListQuery["status"] })}><option value="">All statuses</option><option value="completed">Completed</option><option value="entered-in-error">Entered in error</option></select><button type="button" onClick={onApply}>Apply</button></div>;
}

function CareItemFilters({ filters, onChange, onApply }: { filters: CareItemListQuery; onChange: (next: Partial<CareItemListQuery>) => void; onApply: () => void; }) {
  return <div className="care-filters"><input aria-label="Search care items" placeholder="Search care items" value={filters.search ?? ""} onChange={(event) => onChange({ search: event.target.value })} /><select aria-label="Filter care item kind" value={filters.kind ?? ""} onChange={(event) => onChange({ kind: (event.target.value || undefined) as CareItemListQuery["kind"] })}><option value="">All kinds</option>{careItemKindCodes.map((kind) => <option key={kind} value={kind}>{careItemKindLabels[kind]}</option>)}</select><select aria-label="Filter care item status" value={filters.status ?? ""} onChange={(event) => onChange({ status: (event.target.value || undefined) as CareItemListQuery["status"] })}><option value="">All statuses</option><option value="open">Open</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="skipped">Skipped</option></select><button type="button" onClick={onApply}>Apply</button></div>;
}

function HealthEventEditor({ draft, busy, onChange, onCancel, onSave }: { draft: HealthEventDraft; busy: boolean; onChange: (next: HealthEventDraft) => void; onCancel: () => void; onSave: () => void; }) {
  return <form className="care-editor" onSubmit={(event) => { event.preventDefault(); onSave(); }}><h2 tabIndex={-1}>{healthEventKindLabels[draft.kind]}</h2><label>Kind<select value={draft.kind} onChange={(event) => onChange({ ...draft, kind: event.target.value as HealthEventDraft["kind"] })}>{healthEventKindCodes.map((kind) => <option key={kind} value={kind}>{healthEventKindLabels[kind]}</option>)}</select></label><label>Status<select value={draft.status} onChange={(event) => onChange({ ...draft, status: event.target.value as HealthEventDraft["status"] })}><option value="completed">Completed</option><option value="entered-in-error">Entered in error</option></select></label><label>Date<input type="date" value={toDateOnly(draft.occurredAt)} onChange={(event) => onChange({ ...draft, occurredAt: fromDateOnly(event.target.value) || draft.occurredAt })} /></label><label>Provider<input value={draft.provider ?? ""} maxLength={160} onChange={(event) => onChange({ ...draft, provider: event.target.value })} /></label><label>Notes<textarea value={draft.notes ?? ""} maxLength={4000} onChange={(event) => onChange({ ...draft, notes: event.target.value })} /></label><div className="care-editor-actions"><button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button><button type="button" onClick={onCancel}>Cancel</button></div></form>;
}

function CareItemEditor({ draft, busy, onChange, onCancel, onSave }: { draft: CareItemDraft; busy: boolean; onChange: (next: CareItemDraft) => void; onCancel: () => void; onSave: () => void; }) {
  return (
    <form className="care-editor" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      <h2 tabIndex={-1}>{draft.title || "Care item"}</h2>
      <label>Title<input value={draft.title} maxLength={160} onChange={(event) => onChange({ ...draft, title: event.target.value })} /></label>
      <label>Kind<select value={draft.kind} onChange={(event) => onChange({ ...draft, kind: event.target.value as CareItemDraft["kind"] })}>{careItemKindCodes.map((kind) => <option key={kind} value={kind}>{careItemKindLabels[kind]}</option>)}</select></label>
      {draft.status === "completed" ? <div className="care-fixed-field"><span>Status</span><strong>Completed</strong></div> : <label>Status<select value={draft.status} onChange={(event) => onChange({ ...draft, status: event.target.value as CareItemDraft["status"] })}><option value="open">Open</option><option value="cancelled">Cancelled</option><option value="skipped">Skipped</option></select></label>}
      <label>Due date<input type="date" value={toDateOnly(draft.dueStart)} onChange={(event) => onChange({ ...draft, dueStart: fromDateOnly(event.target.value) || undefined })} /></label>
      <div className="care-reminder-field">
        <label>Reminder date<input type="date" value={toDateOnly(draft.reminderAt)} onChange={(event) => onChange({ ...draft, reminderAt: fromDateOnly(event.target.value) || undefined })} /></label>
        <div className="care-reminder-presets">
          {(["one-day", "one-week"] as CareItemReminderLead[]).map((lead) => <button key={lead} type="button" disabled={!draft.dueStart} onClick={() => onChange({ ...draft, reminderAt: careItemReminderAt(draft.dueStart, lead) })}>{careItemReminderLeadLabels[lead]}</button>)}
        </div>
      </div>
      <label>Notes<textarea value={draft.notes ?? ""} maxLength={4000} onChange={(event) => onChange({ ...draft, notes: event.target.value })} /></label>
      <div className="care-editor-actions"><button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button><button type="button" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

function CareItemCompletionEditor({ item, draft, busy, onChange, onCancel, onComplete }: { item: CareItem; draft: CompletionDraft; busy: boolean; onChange: (next: CompletionDraft) => void; onCancel: () => void; onComplete: () => void; }) {
  return (
    <form className="care-editor care-completion-editor" onSubmit={(event) => { event.preventDefault(); onComplete(); }}>
      <div><h2 tabIndex={-1}>Complete {item.title}</h2><p>Review the health event that will be created.</p></div>
      <label>Date<input type="date" value={toDateOnly(draft.occurredAt)} onChange={(event) => onChange({ ...draft, occurredAt: fromDateOnly(event.target.value) || draft.occurredAt })} /></label>
      <label>Kind<select value={draft.kind} onChange={(event) => onChange({ ...draft, kind: event.target.value as CompletionDraft["kind"] })}>{healthEventKindCodes.map((kind) => <option key={kind} value={kind}>{healthEventKindLabels[kind]}</option>)}</select></label>
      <div className="care-editor-actions"><button type="submit" disabled={busy}>{busy ? "Completing…" : "Complete care item"}</button><button type="button" onClick={onCancel} disabled={busy}>Cancel</button></div>
    </form>
  );
}

function toDateOnly(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (segment: number) => String(segment).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fromDateOnly(value: string): string {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return "";
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date.toISOString()
    : "";
}

function dateOnlyIso(value: Date): string {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function formatWhen(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : "Date unavailable";
}

function normalizeHealthEventDraft(draft: HealthEventDraft): CreateHealthEventInput {
  return { kind: draft.kind, status: draft.status, occurredAt: draft.occurredAt, provider: draft.provider?.trim() || undefined, notes: draft.notes?.trim() || undefined };
}

function normalizeCareItemDraft(draft: CareItemDraft): CreateCareItemInput {
  return { title: draft.title.trim(), kind: draft.kind, dueStart: draft.dueStart || undefined, reminderAt: draft.reminderAt || undefined, priority: draft.priority, status: draft.status, notes: draft.notes?.trim() || undefined };
}

function formatEventReference(entry: NonNullable<CareItem["completedHealthEvent"]>): string {
  return [healthEventKindLabels[entry.kind], formatWhen(entry.occurredAt), entry.provider].filter(Boolean).join(" · ");
}

function careItemKindLabel(kind: string): string {
  if (isCareItemKind(kind)) return careItemKindLabels[kind];
  return kind;
}
