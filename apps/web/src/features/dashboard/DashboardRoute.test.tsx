import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsSummary, AppBootstrap, Profile } from "@vitana/shared";
import { api } from "../../api.js";
import { DashboardRoute } from "./DashboardRoute.js";

vi.mock("../../api.js", () => ({
  api: {
    llm: { config: vi.fn() },
    cloudAiConsent: { set: vi.fn() },
    generateInsight: vi.fn()
  }
}));

const profile: Profile = {
  id: "self",
  displayName: "Local user",
  units: "metric",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

const analytics: AnalyticsSummary = {
  counts: { imports: 0, observations: 0, samples: 0, activities: 0, insights: 0, healthEvents: 0, careItems: 0 },
  latestMetrics: [],
  trendCards: [],
  labAlerts: [],
  evidenceDigest: []
};

function renderRoute(bootstrapProfile: Profile = profile) {
  const onDataChanged = vi.fn().mockResolvedValue(undefined);
  const onNotice = vi.fn();
  render(
    <DashboardRoute
      bootstrap={{ profile: bootstrapProfile } as AppBootstrap}
      analytics={analytics}
      profile={bootstrapProfile}
      onEditProfile={vi.fn()}
      onNavigateSummary={vi.fn()}
      onNavigateMeasurement={vi.fn()}
      onDataChanged={onDataChanged}
      onNotice={onNotice}
    />
  );
  return { onDataChanged, onNotice };
}

beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
});

describe("DashboardRoute AI insights", () => {
  it("asks for cloud consent and generates after consent is accepted", async () => {
    vi.mocked(api.llm.config).mockResolvedValue({
      provider: "openai",
      endpoint: "https://example.openai.azure.com",
      model: "configured-model",
      timeoutMs: 30000
    });
    vi.mocked(api.cloudAiConsent.set).mockResolvedValue({
      enabled: true,
      providerScopeAccepted: true,
      consentVersion: "v1"
    });
    vi.mocked(api.generateInsight).mockResolvedValue({} as never);
    const { onDataChanged, onNotice } = renderRoute();

    fireEvent.click(screen.getByRole("button", { name: /generate insights/i }));

    const dialog = await screen.findByRole("dialog", { name: /allow cloud ai insights/i });
    expect(api.generateInsight).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /allow and generate/i }));

    await waitFor(() => expect(api.generateInsight).toHaveBeenCalledOnce());
    expect(api.cloudAiConsent.set).toHaveBeenCalledWith({
      enabled: true,
      providerScopeAccepted: true,
      consentVersion: "v1"
    });
    expect(dialog).not.toHaveAttribute("open");
    expect(onDataChanged).toHaveBeenCalledOnce();
    expect(onNotice).toHaveBeenCalledWith("Insight generated using the configured AI model.");
  });

  it("generates immediately when cloud consent is already enabled", async () => {
    vi.mocked(api.llm.config).mockResolvedValue({
      provider: "openai",
      endpoint: "https://example.openai.azure.com",
      model: "configured-model",
      timeoutMs: 30000
    });
    vi.mocked(api.generateInsight).mockResolvedValue({} as never);
    renderRoute({
      ...profile,
      cloudAiConsent: { enabled: true, providerScopeAccepted: true, consentVersion: "v1" }
    });

    fireEvent.click(screen.getByRole("button", { name: /generate insights/i }));

    await waitFor(() => expect(api.generateInsight).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog", { name: /allow cloud ai insights/i })).not.toBeInTheDocument();
    expect(api.cloudAiConsent.set).not.toHaveBeenCalled();
  });
});
