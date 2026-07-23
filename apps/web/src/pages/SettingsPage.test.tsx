import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDesktop: vi.fn(),
  saveDesktop: vi.fn(),
  getUpdates: vi.fn(),
  checkUpdates: vi.fn(),
  downloadUpdates: vi.fn(),
  restartUpdates: vi.fn(),
  resetMeasurementMetadata: vi.fn()
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
    },
    measurementTypes: { resetFromRegistry: mocks.resetMeasurementMetadata }
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
  mocks.resetMeasurementMetadata.mockResolvedValue({ profileId: "self", refreshed: 108, inserted: 0 });
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
    expect(await screen.findByRole("progressbar")).toHaveAttribute("value", "0");
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

  it("confirms and resets built-in measurement metadata for the active profile", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SettingsPage view="app" onViewChange={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Reset metadata" }));

    await waitFor(() => expect(mocks.resetMeasurementMetadata).toHaveBeenCalledOnce());
    expect(confirm).toHaveBeenCalledOnce();
    expect(await screen.findByText("Reset 108 measurement types.")).toBeInTheDocument();
  });
});
