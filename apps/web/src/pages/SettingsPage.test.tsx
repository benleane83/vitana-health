import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDesktop: vi.fn(),
  saveDesktop: vi.fn(),
  getUpdates: vi.fn(),
  checkUpdates: vi.fn(),
  downloadUpdates: vi.fn(),
  restartUpdates: vi.fn()
}));

vi.mock("../api.js", () => ({
  api: {
    settings: {
      desktop: { get: mocks.getDesktop, save: mocks.saveDesktop },
      updates: {
        get: mocks.getUpdates,
        check: mocks.checkUpdates,
        download: mocks.downloadUpdates,
        restart: mocks.restartUpdates
      }
    }
  }
}));

import { SettingsPage } from "./SettingsPage.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDesktop.mockResolvedValue({ supported: true, backgroundServiceEnabled: false });
  mocks.getUpdates.mockResolvedValue({
    status: "available",
    currentVersion: "1.0.0",
    availableVersion: "1.1.0",
    channel: "lan"
  });
});

describe("desktop update settings", () => {
  it("shows the immutable channel and delegates download", async () => {
    mocks.downloadUpdates.mockResolvedValue({
      status: "downloading",
      currentVersion: "1.0.0",
      availableVersion: "1.1.0",
      channel: "lan",
      progress: { percent: 0, transferred: 0, total: 0 }
    });
    render(<SettingsPage view="app" onViewChange={() => {}} />);
    expect(await screen.findByText(/LAN test channel/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download update" }));
    await waitFor(() => expect(mocks.downloadUpdates).toHaveBeenCalledOnce());
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "0");
  });

  it("clearly reports unsupported web development mode", async () => {
    mocks.getUpdates.mockResolvedValue({
      status: "unsupported",
      currentVersion: "development",
      channel: null
    });
    render(<SettingsPage view="app" onViewChange={() => {}} />);
    expect(await screen.findByText(/unavailable in web development mode/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /check for updates/i })).not.toBeInTheDocument();
  });
});
