import { useState } from "react";
import type { AppBootstrap, BackupInspectResponse, RestoreDecision } from "@local-fitness-advisor/shared";
import { api } from "../../api.js";
import { ExportPage } from "../../pages/ExportPage.js";

type RestoreSelection = {
  profileId: string;
  decision: RestoreDecision;
  acknowledgeReplacement?: string;
};

export function ExportRoute({ bootstrap }: { bootstrap?: AppBootstrap }) {
  const [status, setStatus] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const [backupPassphrase, setBackupPassphrase] = useState("");
  const [backupPassphraseConfirmation, setBackupPassphraseConfirmation] = useState("");
  const [backupScope, setBackupScope] = useState<"active" | "all">("all");
  const [backupStatus, setBackupStatus] = useState<{ busy: boolean; error?: string; success?: string }>({ busy: false });
  const [restoreFile, setRestoreFile] = useState<File>();
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [inspection, setInspection] = useState<BackupInspectResponse>();
  const [restoreSelections, setRestoreSelections] = useState<RestoreSelection[]>([]);
  const [restoreStatus, setRestoreStatus] = useState<{ busy: boolean; error?: string; success?: string }>({ busy: false });

  async function download() {
    setStatus({ busy: true });
    try {
      const { blob, filename } = await api.exportPdf();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      setStatus({ busy: false });
    } catch (error) {
      setStatus({
        busy: false,
        error: error instanceof Error ? error.message : "Unable to create the PDF report."
      });
    }
  }

  async function createBackup() {
    setBackupStatus({ busy: true });
    try {
      const { blob, filename } = await api.backups.create({ passphrase: backupPassphrase, scope: backupScope });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      setBackupPassphrase("");
      setBackupPassphraseConfirmation("");
      setBackupStatus({ busy: false, success: "Encrypted backup downloaded." });
    } catch (error) {
      setBackupStatus({
        busy: false,
        error: error instanceof Error ? error.message : "Unable to create the backup."
      });
    }
  }

  async function inspectBackup() {
    if (!restoreFile) return;
    setRestoreStatus({ busy: true });
    try {
      const result = await api.backups.inspect(restoreFile, restorePassphrase);
      setInspection(result);
      setRestoreSelections(result.profiles.map((profile) => ({
        profileId: profile.profileId,
        decision: "create-copy"
      })));
      setRestoreStatus({ busy: false });
    } catch (error) {
      setInspection(undefined);
      setRestoreSelections([]);
      setRestoreStatus({
        busy: false,
        error: error instanceof Error ? error.message : "Unable to inspect the backup."
      });
    }
  }

  async function restoreBackup() {
    if (!restoreFile) return;
    setRestoreStatus({ busy: true });
    try {
      const result = await api.backups.restore(restoreFile, restorePassphrase, restoreSelections);
      const successful = result.restored.filter((entry) => entry.success).length;
      const failed = result.restored.length - successful;
      setRestoreStatus({
        busy: false,
        success: failed === 0
          ? `${successful} profile${successful === 1 ? "" : "s"} restored.`
          : `${successful} profile${successful === 1 ? "" : "s"} restored; ${failed} failed.`
      });
    } catch (error) {
      setRestoreStatus({
        busy: false,
        error: error instanceof Error ? error.message : "Unable to restore the backup."
      });
    }
  }

  return (
    <ExportPage
      busy={status.busy}
      error={status.error}
      hasHealthData={Boolean(
        bootstrap && (bootstrap.counts.observations || bootstrap.counts.samples || bootstrap.counts.activities)
      )}
      onDownload={() => { void download(); }}
      backupPassphrase={backupPassphrase}
      backupPassphraseConfirmation={backupPassphraseConfirmation}
      backupScope={backupScope}
      backupStatus={backupStatus}
      onBackupPassphraseChange={setBackupPassphrase}
      onBackupPassphraseConfirmationChange={setBackupPassphraseConfirmation}
      onBackupScopeChange={setBackupScope}
      onCreateBackup={() => { void createBackup(); }}
      restoreFile={restoreFile}
      restorePassphrase={restorePassphrase}
      inspection={inspection}
      restoreSelections={restoreSelections}
      restoreStatus={restoreStatus}
      onRestoreFileChange={(file) => {
        setRestoreFile(file);
        setInspection(undefined);
        setRestoreSelections([]);
        setRestoreStatus({ busy: false });
      }}
      onRestorePassphraseChange={setRestorePassphrase}
      onInspectBackup={() => { void inspectBackup(); }}
      onRestoreSelectionChange={(profileId, decision) => {
        setRestoreSelections((selections) => selections.map((selection) => selection.profileId === profileId
          ? { ...selection, decision, acknowledgeReplacement: undefined }
          : selection
        ));
      }}
      onReplacementAcknowledgmentChange={(profileId, acknowledged) => {
        setRestoreSelections((selections) => selections.map((selection) => selection.profileId === profileId
          ? { ...selection, acknowledgeReplacement: acknowledged ? "REPLACE_CONFIRMED" : undefined }
          : selection
        ));
      }}
      onRestoreBackup={() => { void restoreBackup(); }}
    />
  );
}