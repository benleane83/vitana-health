import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExportPage } from "./ExportPage.js";

describe("backup restore actions", () => {
  it("offers Load and Skip for new profile IDs while retaining conflict actions for existing IDs", () => {
    render(
      <ExportPage
        busy={false}
        hasHealthData={false}
        onDownload={vi.fn()}
        xlsxStatus={{ busy: false }}
        onDownloadXlsx={vi.fn()}
        backupPassphrase=""
        backupPassphraseConfirmation=""
        backupScope="all"
        backupStatus={{ busy: false }}
        onBackupPassphraseChange={vi.fn()}
        onBackupPassphraseConfirmationChange={vi.fn()}
        onBackupScopeChange={vi.fn()}
        onCreateBackup={vi.fn()}
        restorePassphrase=""
        inspection={{
          formatVersion: 1,
          createdAt: "2026-08-05T00:00:00.000Z",
          scope: "all",
          profiles: [
            {
              profileId: "new-profile",
              displayName: "New profile",
              digestValid: true,
              observationCount: 10,
              existsLocally: false
            },
            {
              profileId: "existing-profile",
              displayName: "Existing profile",
              digestValid: true,
              observationCount: 20,
              existsLocally: true
            }
          ]
        }}
        restoreSelections={[
          { profileId: "new-profile", decision: "create-copy" },
          { profileId: "existing-profile", decision: "create-copy" }
        ]}
        restoreStatus={{ busy: false }}
        onRestoreFileChange={vi.fn()}
        onRestorePassphraseChange={vi.fn()}
        onInspectBackup={vi.fn()}
        onRestoreSelectionChange={vi.fn()}
        onReplacementAcknowledgmentChange={vi.fn()}
        onRestoreBackup={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "Backup & restore" }));
    const actions = screen.getAllByLabelText("Restore action");

    expect(within(actions[0]).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Load",
      "Skip"
    ]);
    expect(within(actions[1]).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Create a copy",
      "Replace existing profile",
      "Skip"
    ]);
  });

  it("exposes the health data workbook tab and preserves keyboard tab navigation", () => {
    const onDownloadXlsx = vi.fn();
    render(
      <ExportPage
        busy={false}
        hasHealthData={false}
        onDownload={vi.fn()}
        xlsxStatus={{ busy: false }}
        onDownloadXlsx={onDownloadXlsx}
        backupPassphrase=""
        backupPassphraseConfirmation=""
        backupScope="all"
        backupStatus={{ busy: false }}
        onBackupPassphraseChange={vi.fn()}
        onBackupPassphraseConfirmationChange={vi.fn()}
        onBackupScopeChange={vi.fn()}
        onCreateBackup={vi.fn()}
        restorePassphrase=""
        restoreSelections={[]}
        restoreStatus={{ busy: false }}
        onRestoreFileChange={vi.fn()}
        onRestorePassphraseChange={vi.fn()}
        onInspectBackup={vi.fn()}
        onRestoreSelectionChange={vi.fn()}
        onReplacementAcknowledgmentChange={vi.fn()}
        onRestoreBackup={vi.fn()}
      />
    );

    const pdfTab = screen.getByRole("tab", { name: "PDF report" });
    fireEvent.keyDown(pdfTab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Excel workbook" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("status")).toHaveTextContent("No health records are available yet");
    fireEvent.click(screen.getByRole("button", { name: "Download Excel workbook" }));
    expect(onDownloadXlsx).toHaveBeenCalledOnce();
  });

  it("explains each backup passphrase field with an accessible info control", () => {
    render(
      <ExportPage
        busy={false}
        hasHealthData={false}
        onDownload={vi.fn()}
        xlsxStatus={{ busy: false }}
        onDownloadXlsx={vi.fn()}
        backupPassphrase=""
        backupPassphraseConfirmation=""
        backupScope="all"
        backupStatus={{ busy: false }}
        onBackupPassphraseChange={vi.fn()}
        onBackupPassphraseConfirmationChange={vi.fn()}
        onBackupScopeChange={vi.fn()}
        onCreateBackup={vi.fn()}
        restorePassphrase=""
        restoreSelections={[]}
        restoreStatus={{ busy: false }}
        onRestoreFileChange={vi.fn()}
        onRestorePassphraseChange={vi.fn()}
        onInspectBackup={vi.fn()}
        onRestoreSelectionChange={vi.fn()}
        onReplacementAcknowledgmentChange={vi.fn()}
        onRestoreBackup={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "Backup & restore" }));

    const infoButtons = screen.getAllByRole("button", { name: "What is a backup passphrase?" });
    expect(infoButtons).toHaveLength(3);
    expect(document.getElementById("backup-passphrase-info")).toHaveTextContent("locks your backup");
    expect(document.getElementById("backup-passphrase-confirmation-info")).toHaveTextContent("cannot recover it");
    expect(document.getElementById("restore-passphrase-info")).toHaveTextContent("open or restore it later");
    expect(screen.getByLabelText("Confirm backup passphrase")).toHaveAttribute(
      "aria-describedby",
      "backup-passphrase-confirmation-info"
    );
  });
});