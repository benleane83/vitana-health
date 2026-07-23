import { useState } from "react";
import type { KeyboardEvent } from "react";
import { safetyNotice } from "@vitana/shared";
import type { BackupInspectResponse, RestoreDecision } from "@vitana/shared";

const minBackupPassphraseLength = 12;
type ExportView = "report" | "backup";

export function ExportPage({
  busy,
  error,
  hasHealthData,
  onDownload,
  backupPassphrase,
  backupPassphraseConfirmation,
  backupScope,
  backupStatus,
  onBackupPassphraseChange,
  onBackupPassphraseConfirmationChange,
  onBackupScopeChange,
  onCreateBackup,
  restoreFile,
  restorePassphrase,
  inspection,
  restoreSelections,
  restoreStatus,
  onRestoreFileChange,
  onRestorePassphraseChange,
  onInspectBackup,
  onRestoreSelectionChange,
  onReplacementAcknowledgmentChange,
  onRestoreBackup
}: {
  busy: boolean;
  error?: string;
  hasHealthData: boolean;
  onDownload: () => void;
  backupPassphrase: string;
  backupPassphraseConfirmation: string;
  backupScope: "active" | "all";
  backupStatus: { busy: boolean; error?: string; success?: string };
  onBackupPassphraseChange: (value: string) => void;
  onBackupPassphraseConfirmationChange: (value: string) => void;
  onBackupScopeChange: (value: "active" | "all") => void;
  onCreateBackup: () => void;
  restoreFile?: File;
  restorePassphrase: string;
  inspection?: BackupInspectResponse;
  restoreSelections: Array<{ profileId: string; decision: RestoreDecision; acknowledgeReplacement?: string }>;
  restoreStatus: { busy: boolean; error?: string; success?: string };
  onRestoreFileChange: (file?: File) => void;
  onRestorePassphraseChange: (value: string) => void;
  onInspectBackup: () => void;
  onRestoreSelectionChange: (profileId: string, decision: RestoreDecision) => void;
  onReplacementAcknowledgmentChange: (profileId: string, acknowledged: boolean) => void;
  onRestoreBackup: () => void;
}) {
  const [view, setView] = useState<ExportView>("report");
  const canCreateBackup = backupPassphrase.length >= minBackupPassphraseLength && backupPassphrase === backupPassphraseConfirmation;
  const canInspectBackup = Boolean(restoreFile) && restorePassphrase.length >= minBackupPassphraseLength;
  const canRestore = inspection !== undefined && restoreSelections.some(
    (selection) => selection.decision !== "skip"
  ) && restoreSelections.every(
    (selection) => selection.decision !== "replace" || selection.acknowledgeReplacement === "REPLACE_CONFIRMED"
  ) && inspection.profiles.every((profile) => profile.digestValid);
  const reportTabId = "export-tab-report";
  const backupTabId = "export-tab-backup";
  const reportPanelId = "export-panel-report";
  const backupPanelId = "export-panel-backup";

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentView: ExportView) {
    const views: ExportView[] = ["report", "backup"];
    const currentIndex = views.indexOf(currentView);
    let nextIndex: number | undefined;

    if (event.key === "ArrowDown" || event.key === "ArrowRight") nextIndex = (currentIndex + 1) % views.length;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + views.length) % views.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = views.length - 1;
    if (nextIndex === undefined) return;

    event.preventDefault();
    const nextView = views[nextIndex];
    setView(nextView);
    const nextTabId = nextView === "report" ? reportTabId : backupTabId;
    event.currentTarget.parentElement?.querySelector<HTMLElement>(`#${nextTabId}`)?.focus();
  }

  return (
    <section className="export-page">
      <div className="export-header">
        <div>
          <h1>Export</h1>
        </div>
        <p className="export-copy">Download a shareable report or create and restore encrypted local profile backups.</p>
      </div>
      <div className="export-workspace">
        <div className="export-tabs" role="tablist" aria-label="Export tools" aria-orientation="vertical">
          <button
            id={reportTabId}
            type="button"
            role="tab"
            aria-selected={view === "report"}
            aria-controls={reportPanelId}
            className={view === "report" ? "active" : ""}
            tabIndex={view === "report" ? 0 : -1}
            onClick={() => setView("report")}
            onKeyDown={(event) => handleTabKeyDown(event, "report")}
          >
            PDF report
          </button>
          <button
            id={backupTabId}
            type="button"
            role="tab"
            aria-selected={view === "backup"}
            aria-controls={backupPanelId}
            className={view === "backup" ? "active" : ""}
            tabIndex={view === "backup" ? 0 : -1}
            onClick={() => setView("backup")}
            onKeyDown={(event) => handleTabKeyDown(event, "backup")}
          >
            Backup &amp; restore
          </button>
        </div>

        {view === "report" ? (
          <section className="panel export-tool-panel" id={reportPanelId} role="tabpanel" aria-labelledby={reportTabId}>
            <h2>Export PDF</h2>
            <p>
              Download a clinician-oriented report containing your profile details, health-data totals, latest measurements,
              flagged laboratory results, trends, and imported-source provenance.
            </p>
            <p className="summary-detail-hint">{safetyNotice}</p>
            <div aria-live="polite" aria-atomic="true">
              {!hasHealthData ? (
                <p className="empty" role="status">No health data has been imported yet. The report will show that no records are available.</p>
              ) : null}
              {error ? <p className="empty" role="alert">{error}</p> : null}
            </div>
            <button type="button" onClick={onDownload} disabled={busy}>
              {busy ? "Preparing PDF…" : "Download PDF report"}
            </button>
          </section>
        ) : (
          <div className="export-backup-stack" id={backupPanelId} role="tabpanel" aria-labelledby={backupTabId}>
            <section className="panel export-tool-panel">
              <h2>Back up profiles</h2>
              <p>Create a passphrase-protected backup of the selected profiles. Keep the passphrase separately; it cannot be recovered.</p>
              <label>
                Profiles to include
                <select value={backupScope} onChange={(event) => onBackupScopeChange(event.target.value as "active" | "all")}>
                  <option value="all">All profiles</option>
                  <option value="active">Active profile only</option>
                </select>
              </label>
              <label>
                Backup passphrase
                <input type="password" autoComplete="new-password" minLength={minBackupPassphraseLength} value={backupPassphrase} onChange={(event) => onBackupPassphraseChange(event.target.value)} />
              </label>
              <label>
                Confirm backup passphrase
                <input type="password" autoComplete="new-password" minLength={minBackupPassphraseLength} value={backupPassphraseConfirmation} onChange={(event) => onBackupPassphraseConfirmationChange(event.target.value)} />
              </label>
              <div aria-live="polite" aria-atomic="true">
                {backupPassphrase && backupPassphrase.length < minBackupPassphraseLength ? <p className="empty" role="status">Use at least 12 characters.</p> : null}
                {backupPassphraseConfirmation && backupPassphrase !== backupPassphraseConfirmation ? <p className="empty" role="status">Passphrases do not match.</p> : null}
                {backupStatus.error ? <p className="empty" role="alert">{backupStatus.error}</p> : null}
                {backupStatus.success ? <p className="empty" role="status">{backupStatus.success}</p> : null}
              </div>
              <button className="export-primary-action" type="button" onClick={onCreateBackup} disabled={backupStatus.busy || !canCreateBackup}>
                {backupStatus.busy ? "Creating backup…" : "Download encrypted backup"}
              </button>
            </section>

            <section className="panel export-tool-panel">
              <h2>Restore profiles</h2>
              <p>Inspect a backup before restoring it. Creating a copy is the default action.</p>
              <label>
                Backup file
                <input type="file" accept=".vitana-backup,application/octet-stream" onChange={(event) => onRestoreFileChange(event.target.files?.[0])} />
              </label>
              {restoreFile ? <p className="summary-detail-hint">Selected: {restoreFile.name}</p> : null}
              <label>
                Backup passphrase
                <input type="password" autoComplete="current-password" minLength={minBackupPassphraseLength} value={restorePassphrase} onChange={(event) => onRestorePassphraseChange(event.target.value)} />
              </label>
              <button className="export-primary-action" type="button" onClick={onInspectBackup} disabled={restoreStatus.busy || !canInspectBackup}>
                {restoreStatus.busy && !inspection ? "Inspecting backup…" : "Inspect backup"}
              </button>
              {inspection ? (
                <div className="export-inspection-results">
                  <h3>Profiles in backup</h3>
                  <p className="summary-detail-hint">Created {new Date(inspection.createdAt).toLocaleString()}.</p>
                  {inspection.profiles.map((profile) => {
                    const selection = restoreSelections.find((entry) => entry.profileId === profile.profileId);
                    return (
                      <fieldset key={profile.profileId}>
                        <legend>{profile.displayName} ({profile.observationCount} observations)</legend>
                        {!profile.digestValid ? <p className="empty" role="alert">This profile failed its integrity check and cannot be restored.</p> : null}
                        <label>
                          Restore action
                          <select value={selection?.decision ?? "skip"} onChange={(event) => onRestoreSelectionChange(profile.profileId, event.target.value as RestoreDecision)}>
                            <option value="create-copy">Create a copy</option>
                            <option value="replace">Replace existing profile</option>
                            <option value="skip">Skip</option>
                          </select>
                        </label>
                        {selection?.decision === "replace" ? (
                          <label className="export-replacement-acknowledgment">
                            <input
                              type="checkbox"
                              checked={selection.acknowledgeReplacement === "REPLACE_CONFIRMED"}
                              onChange={(event) => onReplacementAcknowledgmentChange(profile.profileId, event.target.checked)}
                            />
                            I understand this replaces the local profile data.
                          </label>
                        ) : null}
                      </fieldset>
                    );
                  })}
                  <button className="export-restore-action" type="button" onClick={onRestoreBackup} disabled={restoreStatus.busy || !canRestore}>
                    {restoreStatus.busy ? "Restoring backup…" : "Restore selected profiles"}
                  </button>
                </div>
              ) : null}
              <div aria-live="polite" aria-atomic="true">
                {restoreStatus.error ? <p className="empty" role="alert">{restoreStatus.error}</p> : null}
                {restoreStatus.success ? <p className="empty" role="status">{restoreStatus.success}</p> : null}
              </div>
            </section>
          </div>
        )}
      </div>
    </section>
  );
}
