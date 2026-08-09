// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ManualGroupSaveDialog } from "./ManualGroupSaveDialog.js";

describe("ManualGroupSaveDialog", () => {
  it("describes all pending rows in future-facing language", () => {
    render(
      <ManualGroupSaveDialog
        open={true}
        defaultGroup="Activity"
        rowCount={2}
        groupName=""
        onGroupNameChange={vi.fn()}
        onSave={vi.fn()}
        onSkip={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText(
      "You are adding 2 Activity rows. Save it as a custom group to preload these measurements next time."
    )).toBeInTheDocument();
  });
});