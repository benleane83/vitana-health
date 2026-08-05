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
});