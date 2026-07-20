import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { defaultMeasurementTypes, getPreferredUnit, type AppBootstrap, type MeasurementType, type ProfileListEntry, type UnitSystem } from "@local-fitness-advisor/shared";
import { api } from "../api.js";
import type { PairedDevice, PendingPairing } from "../api.js";
import type { ImportMode, ManualMarkerRow } from "../types.js";
import { groupMeasurementTypes, measurementCategoryLabels } from "../utils.js";
import { ManualImportFeature } from "../features/import/ManualImportFeature.js";
import { UploadImportFeature } from "../features/import/UploadImportFeature.js";

// ─── Tab IDs for tablist/tabpanel ARIA wiring ─────────────────────────────────

export function ImportPage({
  mode,
  onModeChange,
  bootstrap,
  onDataChanged,
  onNotice,
  profiles,
  activeProfileId,
  units
}: {
  mode: ImportMode;
  onModeChange: (mode: ImportMode) => void;
  bootstrap?: AppBootstrap;
  onDataChanged: () => Promise<void>;
  onNotice: (message: string) => void;
  profiles: ProfileListEntry[];
  activeProfileId?: string;
  units: UnitSystem;
}) {
  const manualTabId = "import-tab-manual";
  const uploadTabId = "import-tab-upload";
  const syncTabId = "import-tab-sync";
  const manualPanelId = "import-panel-manual";
  const uploadPanelId = "import-panel-upload";
  const syncPanelId = "import-panel-sync";
  const tabs: Array<{ mode: ImportMode; id: string }> = [
    { mode: "manual", id: manualTabId },
    { mode: "upload", id: uploadTabId },
    { mode: "sync", id: syncTabId }
  ];

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, currentMode: ImportMode) {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = tabs.findIndex((item) => item.mode === currentMode);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (currentIndex + (["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1) + tabs.length) % tabs.length;
    const nextTab = tabs[nextIndex];
    onModeChange(nextTab.mode);
    document.getElementById(nextTab.id)?.focus();
  }

  return (
    <section className="import-page">
      <div className="import-header">
        <div>
          <h1>Import</h1>
        </div>
        <p className="import-copy">
          Add observations manually, from an existing report, or sync your fitness tracker.
        </p>
      </div>

      <div className="import-workspace">
        {/* Tab list — proper ARIA tab semantics */}
        <div className="import-tabs" role="tablist" aria-label="Import mode" aria-orientation="vertical">
          <button
            id={manualTabId}
            role="tab"
            aria-selected={mode === "manual"}
            aria-controls={manualPanelId}
            className={mode === "manual" ? "active" : ""}
            onClick={() => onModeChange("manual")}
            onKeyDown={(event) => handleTabKeyDown(event, "manual")}
            tabIndex={mode === "manual" ? 0 : -1}
          >
            Manual
          </button>
          <button
            id={uploadTabId}
            role="tab"
            aria-selected={mode === "upload"}
            aria-controls={uploadPanelId}
            className={mode === "upload" ? "active" : ""}
            onClick={() => onModeChange("upload")}
            onKeyDown={(event) => handleTabKeyDown(event, "upload")}
            tabIndex={mode === "upload" ? 0 : -1}
          >
            Upload
          </button>
          <button
            id={syncTabId}
            role="tab"
            aria-selected={mode === "sync"}
            aria-controls={syncPanelId}
            className={mode === "sync" ? "active" : ""}
            onClick={() => onModeChange("sync")}
            onKeyDown={(event) => handleTabKeyDown(event, "sync")}
            tabIndex={mode === "sync" ? 0 : -1}
          >
            Sync
          </button>
        </div>

        {mode === "manual" ? (
          <div id={manualPanelId} role="tabpanel" aria-labelledby={manualTabId}>
            <ManualImportFeature
              bootstrap={bootstrap}
              units={units}
              onImported={onDataChanged}
              onNotice={onNotice}
            />
          </div>
        ) : mode === "upload" ? (
          <div id={uploadPanelId} role="tabpanel" aria-labelledby={uploadTabId}>
            <UploadImportFeature
              measurementTypes={bootstrap?.measurementTypes?.length ? bootstrap.measurementTypes : defaultMeasurementTypes}
              units={units}
              onImported={onDataChanged}
              onNotice={onNotice}
            />
          </div>
        ) : (
          <div id={syncPanelId} role="tabpanel" aria-labelledby={syncTabId}>
            <SyncImportPanel
              profiles={profiles}
              activeProfileId={activeProfileId}
              onNotice={onNotice}
            />
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Manual lab entry form ────────────────────────────────────────────────────

const customObservationGroupValue = "__custom__";

export function ManualEntryForm({
  busy,
  observationGroup,
  observationGroupOptions,
  labName,
  collectedAt,
  measurementTypes,
  rows,
  onObservationGroupChange,
  onCustomObservationGroupChange,
  onLabNameChange,
  onCollectedAtChange,
  onRowChange,
  onAddRow,
  onRemoveRow,
  onSubmit,
  units
}: {
  busy: boolean;
  observationGroup: string;
  observationGroupOptions: string[];
  labName: string;
  collectedAt: string;
  measurementTypes: MeasurementType[];
  rows: ManualMarkerRow[];
  onObservationGroupChange: (value: string) => void;
  onCustomObservationGroupChange: (value: string) => void;
  onLabNameChange: (value: string) => void;
  onCollectedAtChange: (value: string) => void;
  onRowChange: (id: string, patch: Partial<ManualMarkerRow>) => void;
  onAddRow: () => void;
  onRemoveRow: (id: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  units: UnitSystem;
}) {
  const [customMeasurementRows, setCustomMeasurementRows] = useState<Record<string, true>>({});
  const selectedObservationGroup = observationGroupOptions.includes(observationGroup)
    ? observationGroup
    : customObservationGroupValue;

  useEffect(() => {
    setCustomMeasurementRows((current) => {
      const next: Record<string, true> = {};
      const rowIds = new Set(rows.map((row) => row.id));
      for (const rowId of Object.keys(current)) {
        if (rowIds.has(rowId)) {
          next[rowId] = true;
        }
      }
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [rows]);

  return (
    <form className="labs-manual-form" onSubmit={onSubmit}>
      <div className="manual-entry-intro">
        <h2>Log a reading</h2>
        <p>Start with one reading. Add rows for measurements recorded together.</p>
      </div>
      <div className="labs-manual-meta">
        <div className="labs-manual-field">
          <label htmlFor="manual-collected-at">Observation date</label>
          <input
            id="manual-collected-at"
            type="date"
            value={collectedAt}
            onChange={(event) => onCollectedAtChange(event.target.value)}
          />
        </div>
        <div className="labs-manual-field">
          <label htmlFor="manual-observation-group">Observation group</label>
          <select
            id="manual-observation-group"
            value={selectedObservationGroup}
            onChange={(event) => onObservationGroupChange(
              event.target.value === customObservationGroupValue ? "" : event.target.value
            )}
          >
            {observationGroupOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
            <option value={customObservationGroupValue}>Custom group</option>
          </select>
          {selectedObservationGroup === customObservationGroupValue ? (
            <input
              id="manual-custom-observation-group"
              value={observationGroup}
              onChange={(event) => onCustomObservationGroupChange(event.target.value)}
              placeholder="Enter a custom group"
              aria-label="Custom observation group"
            />
          ) : null}
        </div>
        <div className="labs-manual-field">
          <label htmlFor="manual-lab-name">Lab name (optional)</label>
          <input
            id="manual-lab-name"
            value={labName}
            onChange={(event) => onLabNameChange(event.target.value)}
            placeholder="Quest Diagnostics"
          />
        </div>
      </div>

      <div className="labs-rows" role="table" aria-label="Manual observations">
        <div className="summary-row summary-row-head" role="row">
          <span role="columnheader">Measurement</span>
          <span role="columnheader">Value</span>
          <span role="columnheader">Unit</span>
        </div>
        {rows.map((row, index) => (
          <ManualMeasurementRow
            key={row.id}
            row={row}
            rowIndex={index + 1}
            measurementTypes={measurementTypes}
            customMeasurement={Boolean(customMeasurementRows[row.id])}
            onSetCustomMeasurement={(enabled) => {
              setCustomMeasurementRows((current) => {
                if (enabled) {
                  return { ...current, [row.id]: true };
                }
                if (!(row.id in current)) {
                  return current;
                }
                const next = { ...current };
                delete next[row.id];
                return next;
              });
            }}
            onChange={onRowChange}
            onRemove={onRemoveRow}
            units={units}
          />
        ))}
      </div>

      <div className="labs-actions">
        <button type="button" onClick={onAddRow}>Add row</button>
        <button disabled={busy} type="submit">Import observations</button>
      </div>
    </form>
  );
}

function ManualMeasurementRow({
  row,
  rowIndex,
  measurementTypes,
  customMeasurement,
  onSetCustomMeasurement,
  onChange,
  onRemove,
  units
}: {
  row: ManualMarkerRow;
  rowIndex: number;
  measurementTypes: MeasurementType[];
  customMeasurement: boolean;
  onSetCustomMeasurement: (enabled: boolean) => void;
  onChange: (id: string, patch: Partial<ManualMarkerRow>) => void;
  onRemove: (id: string) => void;
  units: UnitSystem;
}) {
  const measurementSelectId = `manual-measurement-select-${row.id}`;
  const markerInputId = `manual-measurement-input-${row.id}`;
  const codeInputId = `manual-code-input-${row.id}`;
  const valueInputId = `lab-value-${row.id}`;
  const unitInputId = `lab-unit-${row.id}`;
  const selectedMeasurementCode = customMeasurement ? "" : resolveKnownMeasurementSelectionForManual(row, measurementTypes);
  const showCustomFields = selectedMeasurementCode === "";
  const measurementGroups = groupMeasurementTypes(measurementTypes);

  return (
    <div className="summary-row labs-row" role="row">
      <span role="cell" className="labs-marker-cell">
        <label htmlFor={measurementSelectId} className="sr-only">
          Row {rowIndex}: select known measurement
        </label>
        <select
          id={measurementSelectId}
          value={selectedMeasurementCode}
          onChange={(event) => {
            const selectedCode = event.target.value;
            if (!selectedCode) {
              onSetCustomMeasurement(true);
              return;
            }
            onSetCustomMeasurement(false);
            const selectedMeasurement = measurementTypes.find((type) => type.code === selectedCode);
            if (!selectedMeasurement) {
              return;
            }
            onChange(row.id, {
              marker: selectedMeasurement.display,
              measurementCode: selectedMeasurement.code,
              unit: getPreferredUnit(selectedMeasurement, units)
            });
          }}
        >
          <option value="">Custom / free text</option>
          {measurementGroups.length > 1
            ? measurementGroups.map(([category, types]) => (
              <optgroup key={category} label={measurementCategoryLabels[category]}>
                {types.map((type) => (
                  <option value={type.code} key={type.code}>{type.display} ({type.code})</option>
                ))}
              </optgroup>
            ))
            : measurementTypes.map((type) => (
              <option value={type.code} key={type.code}>{type.display} ({type.code})</option>
            ))}
        </select>
        {showCustomFields ? (
          <>
            <label htmlFor={markerInputId} className="sr-only">
              Row {rowIndex}: measurement name
            </label>
            <input
              id={markerInputId}
              value={row.marker}
              onChange={(event) => onChange(row.id, { marker: event.target.value, measurementCode: row.measurementCode })}
              placeholder="HDL cholesterol"
              aria-label={`Row ${rowIndex} measurement name`}
            />
            <label htmlFor={codeInputId} className="sr-only">
              Row {rowIndex}: measurement code
            </label>
            <input
              id={codeInputId}
              value={row.measurementCode ?? ""}
              onChange={(event) => onChange(row.id, { measurementCode: event.target.value })}
              placeholder="hdl_cholesterol"
              aria-label={`Row ${rowIndex} measurement code`}
            />
          </>
        ) : null}
      </span>
      <span role="cell">
        <label htmlFor={valueInputId} className="sr-only">Row {rowIndex} value</label>
        <input
          id={valueInputId}
          inputMode="decimal"
          value={row.value}
          onChange={(event) => onChange(row.id, { value: event.target.value })}
          placeholder="48"
          aria-label={`Row ${rowIndex} value`}
        />
      </span>
      <span role="cell">
        <label htmlFor={unitInputId} className="sr-only">Row {rowIndex} unit</label>
        <input
          id={unitInputId}
          value={row.unit}
          onChange={(event) => onChange(row.id, { unit: event.target.value })}
          placeholder="mg/dL"
          aria-label={`Row ${rowIndex} unit`}
        />
      </span>
      <span role="cell" className="labs-row-actions">
        <button
          type="button"
          onClick={() => onRemove(row.id)}
          aria-label={`Remove row ${rowIndex}`}
        >
          Remove
        </button>
      </span>
    </div>
  );
}

// ─── Fitness tracker pairing panel ────────────────────────────────────────────

function SyncImportPanel({
  profiles,
  activeProfileId,
  onNotice
}: {
  profiles: ProfileListEntry[];
  activeProfileId?: string;
  onNotice: (message: string) => void;
}) {
  const [pendingPairings, setPendingPairings] = useState<PendingPairing[]>([]);
  const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([]);
  const [selectedProfiles, setSelectedProfiles] = useState<Record<string, string>>({});
  const [pendingActionId, setPendingActionId] = useState<string>();
  const activeProfileExists = activeProfileId !== undefined && profiles.some((profile) => profile.id === activeProfileId);
  const defaultProfileId = activeProfileExists ? activeProfileId : profiles[0]?.id ?? "";

  useEffect(() => {
    void api.pairing.devices().then(setPairedDevices).catch(() => setPairedDevices([]));
  }, [pendingPairings]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    async function poll() {
      if (cancelled) return;
      try {
        const result = await api.pairing.pending();
        if (!cancelled) setPendingPairings(result);
      } catch {
        // Pairing is optional and polling resumes on the next interval.
      }
      if (!cancelled) timeoutId = setTimeout(poll, 5000);
    }
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, []);

  async function approve(id: string, profileId: string) {
    if (pendingActionId) return;
    setPendingActionId(id);
    try {
      await api.pairing.approve(id, profileId);
      setPendingPairings(await api.pairing.pending());
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not approve pairing request.");
    } finally {
      setPendingActionId(undefined);
    }
  }

  async function deny(id: string) {
    if (pendingActionId) return;
    setPendingActionId(id);
    try {
      await api.pairing.deny(id);
      setPendingPairings(await api.pairing.pending());
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not deny pairing request.");
    } finally {
      setPendingActionId(undefined);
    }
  }

  async function revokeDevice(id: string) {
    if (pendingActionId) return;
    setPendingActionId(id);
    try {
      await api.pairing.revoke(id);
      setPairedDevices(await api.pairing.devices());
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not revoke paired device.");
    } finally {
      setPendingActionId(undefined);
    }
  }

  return (
    <section className="panel import-source-panel">
      <div>
        <h2>Sync your Android phone</h2>
      </div>
      <p className="empty">
        Bring recent health and activity data from your Android phone into your local vault, including
        steps, heart rate, sleep, and oxygen saturation.
      </p>

      <div className="pairing-section">
        <div>
          <h3>Connect your phone</h3>
        </div>
        <p className="empty">
          In the companion app, choose <strong>Set Up Connection</strong>, then scan this code. Your
          phone will find this server automatically.
        </p>
        <PairingQr />
      </div>

      {pendingPairings.length > 0 ? (
        <div className="pairing-requests" aria-live="polite" aria-label="Pending pairing requests">
          <h3>Connection requests</h3>
          {pendingPairings.map((req) => (
            <div key={req.id} className="pairing-request-row">
              <div className="pairing-request-info">
                <strong>{req.deviceName}</strong>
                <span className="muted">Requested {new Date(req.requestedAt).toLocaleTimeString()}</span>
                 <label>
                   Save data to
                   <select
                     aria-label={`Save data from ${req.deviceName} to profile`}
                     value={selectedProfiles[req.id] ?? defaultProfileId}
                     onChange={(event) => setSelectedProfiles((current) => ({ ...current, [req.id]: event.target.value }))}
                   >
                     {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName}</option>)}
                   </select>
                 </label>
              </div>
              <div className="pairing-request-actions">
                <button
                  type="button"
                  disabled={profiles.length === 0 || pendingActionId !== undefined}
                  onClick={() => {
                    const profileId = selectedProfiles[req.id] ?? defaultProfileId;
                    if (profileId) void approve(req.id, profileId);
                  }}
                  aria-label={`Connect ${req.deviceName}`}
                >Connect</button>
                <button
                  type="button"
                  disabled={pendingActionId !== undefined}
                  onClick={() => { void deny(req.id); }}
                  aria-label={`Do not connect ${req.deviceName}`}
                >Not now</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {pairedDevices.length > 0 ? (
        <div className="pairing-requests" aria-label="Paired devices">
          <h3>Connected devices</h3>
          {pairedDevices.map((device) => (
            <div key={device.id} className="pairing-request-row">
              <div className="pairing-request-info">
                <strong>{device.deviceName}</strong>
                <span className="muted">
                  {device.revokedAt
                    ? `Revoked ${new Date(device.revokedAt).toLocaleString()}`
                    : device.lastUsedAt
                      ? `Last sync ${new Date(device.lastUsedAt).toLocaleString()}`
                      : "Not synced yet"}
                </span>
                        <span className="muted">Saving to {profiles.find((profile) => profile.id === device.allowedProfileIds[0])?.displayName ?? "an unknown profile"}</span>
              </div>
              {!device.revokedAt ? (
                <button
                  type="button"
                  className="pairing-device-revoke"
                  disabled={pendingActionId !== undefined}
                  onClick={() => { void revokeDevice(device.id); }}
                  aria-label={`Disconnect ${device.deviceName}`}
                >Disconnect</button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="import-guidance-grid">
        <div>
          <strong>1. On your phone</strong>
          <span>Open the companion app and choose <em>Set Up Connection</em>.</span>
        </div>
        <div>
          <strong>2. Confirm the connection</strong>
          <span>Scan the code, then choose <em>Connect</em> when a request appears here.</span>
        </div>
        <div>
          <strong>3. Sync when you're ready</strong>
          <span>In the companion app, press <em>Sync</em> to bring in new data.</span>
        </div>
      </div>
    </section>
  );
}

function PairingQr() {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    void api.pairing
      .qr()
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (active) setError("We couldn't create the connection code. Refresh the page and try again.");
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, []);

  if (error) return <p className="empty" role="alert">{error}</p>;
  return (
    <div className="pairing-qr-wrap">
      {url ? (
        <img
          src={url}
          alt="QR code to connect the Android companion app."
          width={200}
          height={200}
          className="pairing-qr"
        />
      ) : (
        <span className="empty" role="status" aria-live="polite">Getting your connection code ready…</span>
      )}
    </div>
  );
}

// ─── Helpers (kept local, not exported) ──────────────────────────────────────

function resolveKnownMeasurementSelectionForManual(row: ManualMarkerRow, measurementTypes: MeasurementType[]): string {
  if (measurementTypes.length === 0) {
    return "";
  }
  const explicitCode = row.measurementCode?.trim();
  if (explicitCode) {
    const byCode = measurementTypes.find((type) => type.code === explicitCode);
    if (byCode) {
      return byCode.code;
    }
  }
  const normalizedLabel = row.marker.trim().toLowerCase();
  if (!normalizedLabel) {
    return "";
  }
  const byLabel = measurementTypes.find((type) => {
    if (type.display.trim().toLowerCase() === normalizedLabel) {
      return true;
    }
    return type.aliases.some((alias) => alias.trim().toLowerCase() === normalizedLabel);
  });
  return byLabel?.code ?? "";
}
