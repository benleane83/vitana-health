import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiQueryResponse, AiQueryTurnContext, AppBootstrap, BiologicalAgeReport, Profile } from "@vitana/shared";
import { api } from "../../api.js";
import { InsightsRoute } from "./InsightsRoute.js";

vi.mock("../../api.js", () => ({
  api: {
    llm: { config: vi.fn() },
    query: { ai: vi.fn() },
    cloudAiConsent: { set: vi.fn() },
    generateInsight: vi.fn(),
    biologicalAge: vi.fn()
  },
  ApiError: class ApiError extends Error {}
}));

const profile: Profile = {
  id: "self",
  displayName: "Local user",
  setupStatus: "complete",
  units: "metric",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

function renderRoute(bootstrapProfile: Profile = profile, tab: "ai-query" | "ai-review" = "ai-review") {
  const onDataChanged = vi.fn().mockResolvedValue(undefined);
  const onNotice = vi.fn();
  const view = render(
    <InsightsRoute
      tab={tab}
      bootstrap={{ profile: bootstrapProfile } as AppBootstrap}
      onTabChange={vi.fn()}
      onDataChanged={onDataChanged}
      onNotice={onNotice}
    />
  );
  return { ...view, onDataChanged, onNotice };
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

describe("InsightsRoute AI review", () => {
  it("keeps AI Query navigation available while replacing its content with a Pro message", () => {
    render(
      <InsightsRoute
        tab="ai-query"
        bootstrap={{ profile } as AppBootstrap}
        onTabChange={vi.fn()}
        onDataChanged={vi.fn().mockResolvedValue(undefined)}
        onNotice={vi.fn()}
        aiQueryAllowed={false}
      />
    );

    expect(screen.getByRole("tab", { name: "AI Query" })).toBeEnabled();
    expect(screen.getByRole("heading", { name: "Available in Vitana Pro" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Ask about your health data")).not.toBeInTheDocument();
  });

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

describe("InsightsRoute Biological Age", () => {
  it("recalculates when the saved profile revision changes", async () => {
    vi.mocked(api.biologicalAge).mockResolvedValue({
      generatedAt: "2026-08-24T13:14:33.369Z",
      models: [],
      disclaimer: "For wellbeing information only."
    } as BiologicalAgeReport);
    const { rerender } = render(
      <InsightsRoute
        tab="biological-age"
        bootstrap={{ profile } as AppBootstrap}
        onTabChange={vi.fn()}
        onDataChanged={vi.fn().mockResolvedValue(undefined)}
        onNotice={vi.fn()}
      />
    );

    await waitFor(() => expect(api.biologicalAge).toHaveBeenCalledOnce());

    rerender(
      <InsightsRoute
        tab="biological-age"
        bootstrap={{
          profile: {
            ...profile,
            birthDate: "1990-01-01",
            updatedAt: "2026-08-24T13:14:33.369Z"
          }
        } as AppBootstrap}
        onTabChange={vi.fn()}
        onDataChanged={vi.fn().mockResolvedValue(undefined)}
        onNotice={vi.fn()}
      />
    );

    await waitFor(() => expect(api.biologicalAge).toHaveBeenCalledTimes(2));
  });
});

describe("InsightsRoute AI Query conversation", () => {
  it("passes the prior response context into a follow-up request", async () => {
    vi.mocked(api.llm.config).mockResolvedValue({
      provider: "ollama",
      endpoint: "http://localhost:11434/api/generate",
      model: "test",
      timeoutMs: 30000
    });
    const context = turnContext();
    vi.mocked(api.query.ai)
      .mockResolvedValueOnce(queryResult("max daily steps last month", context))
      .mockResolvedValueOnce(queryResult("Which day was that on?", context));
    renderRoute(profile, "ai-query");

    const composer = await screen.findByRole("textbox", { name: "Question" });
    fireEvent.change(composer, { target: { value: "max daily steps last month" } });
    fireEvent.submit(composer.closest("form")!);
    await screen.findByText("Answer for max daily steps last month");

    fireEvent.click(screen.getByRole("button", { name: "Which day was that on?" }));
    fireEvent.submit(composer.closest("form")!);

    await waitFor(() => expect(api.query.ai).toHaveBeenCalledTimes(2));
    expect(api.query.ai).toHaveBeenLastCalledWith(
      "Which day was that on?",
      expect.objectContaining({ context, signal: expect.any(AbortSignal) })
    );
  });

  it("aborts an in-flight request when a new conversation starts", async () => {
    vi.mocked(api.llm.config).mockResolvedValue({
      provider: "ollama",
      endpoint: "http://localhost:11434/api/generate",
      model: "test",
      timeoutMs: 30000
    });
    vi.mocked(api.query.ai).mockImplementation(() => new Promise(() => undefined));
    renderRoute(profile, "ai-query");

    const composer = await screen.findByRole("textbox", { name: "Question" });
    fireEvent.change(composer, { target: { value: "average heart rate last month" } });
    fireEvent.submit(composer.closest("form")!);
    await screen.findByText("Querying your health data…");
    const signal = vi.mocked(api.query.ai).mock.calls[0][1]?.signal;

    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));

    expect(signal?.aborted).toBe(true);
    expect(screen.queryByText("You asked")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Question" })).toBeEnabled();
  });

  it("clears conversation context when the active profile changes", async () => {
    vi.mocked(api.llm.config).mockResolvedValue({
      provider: "ollama",
      endpoint: "http://localhost:11434/api/generate",
      model: "test",
      timeoutMs: 30000
    });
    vi.mocked(api.query.ai)
      .mockResolvedValueOnce(queryResult("max daily steps last month", turnContext()))
      .mockResolvedValueOnce(queryResult("average heart rate this month", {
        ...turnContext(),
        profileId: "family-member",
        metric: "heart_rate"
      }));
    const { rerender, onDataChanged, onNotice } = renderRoute(profile, "ai-query");

    const composer = await screen.findByRole("textbox", { name: "Question" });
    fireEvent.change(composer, { target: { value: "max daily steps last month" } });
    fireEvent.submit(composer.closest("form")!);
    await screen.findByText("Answer for max daily steps last month");

    rerender(
      <InsightsRoute
        tab="ai-query"
        bootstrap={{ profile: { ...profile, id: "family-member" } } as AppBootstrap}
        onTabChange={vi.fn()}
        onDataChanged={onDataChanged}
        onNotice={onNotice}
      />
    );

    await waitFor(() => expect(screen.queryByText("You asked")).not.toBeInTheDocument());
    const resetComposer = screen.getByRole("textbox", { name: "Question" });
    fireEvent.change(resetComposer, { target: { value: "average heart rate this month" } });
    fireEvent.submit(resetComposer.closest("form")!);

    await waitFor(() => expect(api.query.ai).toHaveBeenCalledTimes(2));
    expect(api.query.ai).toHaveBeenLastCalledWith(
      "average heart rate this month",
      expect.objectContaining({ context: undefined })
    );
  });
});

function turnContext(): AiQueryTurnContext {
  return {
    version: 1,
    profileId: "self",
    source: "metrics",
    metric: "steps",
    intent: "aggregation",
    aggregation: "max",
    groupBy: null,
    sort: "desc",
    resolvedTimeRange: { start: "2026-07-01", end: "2026-07-31" }
  };
}

function queryResult(question: string, context: AiQueryTurnContext): AiQueryResponse {
  return {
    outcome: "answered",
    question,
    answer: `Answer for ${question}`,
    limitations: [],
    assumptions: [],
    confidence: 1,
    plan: null,
    sql: null,
    rowCount: 1,
    rows: [{ value: 100 }],
    chart: null,
    context,
    suggestedFollowUps: ["Which day was that on?"]
  };
}