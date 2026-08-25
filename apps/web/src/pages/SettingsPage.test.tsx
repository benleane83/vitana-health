import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    channel: "production",
    distributionChannel: "github"
  });
  mocks.resetMeasurementMetadata.mockResolvedValue({ profileId: "self", refreshed: 108, inserted: 0 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("desktop update settings", () => {
  it("announces horizontal tabs when the workspace collapses", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }));

    render(<SettingsPage view="app" onViewChange={() => {}} confirm={vi.fn()} />);

    expect(screen.getByRole("tablist", { name: "Settings sections" })).toHaveAttribute("aria-orientation", "horizontal");
  });

  it("shows the immutable channel and delegates download", async () => {
    mocks.downloadUpdates.mockResolvedValue({
      status: "downloading",
      currentVersion: "1.0.0",
      availableVersion: "1.1.0",
      channel: "production",
      distributionChannel: "github",
      progress: { percent: 0, transferred: 0, total: 0 }
    });
    render(<SettingsPage view="app" onViewChange={() => {}} confirm={vi.fn()} />);
    expect(await screen.findByText(/GitHub release channel/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download update" }));
    await waitFor(() => expect(mocks.downloadUpdates).toHaveBeenCalledOnce());
    expect(await screen.findByRole("progressbar")).toHaveAttribute("value", "0");
  });

  it("clearly reports unsupported web development mode", async () => {
    mocks.getUpdates.mockResolvedValue({
      status: "unsupported",
      currentVersion: "development",
      channel: null,
      distributionChannel: "github"
    });

    render(<SettingsPage view="app" onViewChange={() => {}} confirm={vi.fn()} />);
    expect(await screen.findByText(/unavailable in web development mode/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /check for updates/i })).not.toBeInTheDocument();
  });

  it("reports Microsoft Store update ownership without updater controls", async () => {
    mocks.getUpdates.mockResolvedValue({
      status: "managed",
      currentVersion: "1.0.0",
      channel: null,
      distributionChannel: "store"
    });
    render(<SettingsPage view="app" onViewChange={() => {}} confirm={vi.fn()} />);
    expect(await screen.findByText(/managed automatically by Microsoft Store/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /check for updates/i })).not.toBeInTheDocument();
  });

  it("confirms and resets built-in measurement metadata for the active profile", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    render(<SettingsPage view="app" onViewChange={() => {}} confirm={confirm} />);

    fireEvent.click(await screen.findByRole("button", { name: "Reset metadata" }));

    await waitFor(() => expect(mocks.resetMeasurementMetadata).toHaveBeenCalledOnce());
    expect(confirm).toHaveBeenCalledWith(
      "Reset measurement metadata",
      expect.stringContaining("Reset built-in measurement metadata"),
      "Reset metadata",
      true
    );
    expect(await screen.findByText("Reset 108 measurement types.")).toBeInTheDocument();
  });

  it("uses the shared muted paragraph treatment for the background service description", async () => {
    render(<SettingsPage view="app" onViewChange={() => {}} confirm={vi.fn()} />);

    expect(await screen.findByText(/Keep mobile sync available after closing the window/i)).toHaveClass("empty");
  });
});
