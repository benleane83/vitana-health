import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  aiQueryErrorResponseSchema,
  type AiQueryTurnContext,
  type AppBootstrap,
  type BiologicalAgeReport,
  type CloudAiConsent
} from "@vitana/shared";
import { api, ApiError, type LlmConfig } from "../../api.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { AiReviewPage } from "../../pages/AiReviewPage.js";
import { BiologicalAgePage } from "../../pages/BiologicalAgePage.js";
import { QueryPage, type QueryFailure, type QueryTurn } from "../../pages/QueryPage.js";
import type { InsightsTab } from "../../types.js";

type RemoteState<T, TError = string> = {
  data?: T;
  busy: boolean;
  error?: TError;
};

const insightTabs: InsightsTab[] = ["biological-age", "ai-query", "ai-review"];
const maxConversationTurns = 25;

export function InsightsRoute({
  tab,
  bootstrap,
  onTabChange,
  onDataChanged,
  onNotice
}: {
  tab: InsightsTab;
  bootstrap?: AppBootstrap;
  onTabChange: (tab: InsightsTab) => void;
  onDataChanged: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, currentTab: InsightsTab) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = insightTabs.indexOf(currentTab);
    const resolvedTab = event.key === "Home"
      ? insightTabs[0]
      : event.key === "End"
        ? insightTabs[insightTabs.length - 1]
        : insightTabs[(currentIndex + (event.key === "ArrowRight" ? 1 : -1) + insightTabs.length) % insightTabs.length];
    onTabChange(resolvedTab);
    document.getElementById(`insight-tab-${resolvedTab}`)?.focus();
  }
  const [biologicalAge, setBiologicalAge] = useState<RemoteState<BiologicalAgeReport>>({ busy: false });
  const [queryTurns, setQueryTurns] = useState<QueryTurn[]>([]);
  const [queryContext, setQueryContext] = useState<AiQueryTurnContext>();
  const [question, setQuestion] = useState("");
  const [llmConfig, setLlmConfig] = useState<LlmConfig>();
  const [consentBusy, setConsentBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [consentDialogOpen, setConsentDialogOpen] = useState(false);
  const queryAbortRef = useRef<AbortController | null>(null);
  const queryGenerationRef = useRef(0);
  const queryTurnIdRef = useRef(0);
  const queryBusy = queryTurns.some((turn) => turn.status === "pending");

  useEffect(() => {
    void api.llm.config().then(setLlmConfig).catch(() => setLlmConfig(undefined));
  }, []);

  useEffect(() => {
    queryGenerationRef.current += 1;
    queryAbortRef.current?.abort();
    queryAbortRef.current = null;
    setQueryTurns([]);
    setQueryContext(undefined);
    setQuestion("");
    return () => {
      queryGenerationRef.current += 1;
      queryAbortRef.current?.abort();
    };
  }, [bootstrap?.profile.id]);

  useEffect(() => {
    if (tab !== "biological-age") return;
    let cancelled = false;
    setBiologicalAge((current) => ({ ...current, busy: true, error: undefined }));
    void api.biologicalAge()
      .then((data) => {
        if (!cancelled) setBiologicalAge({ data, busy: false });
      })
      .catch((error: unknown) => {
        if (!cancelled) setBiologicalAge({
          busy: false,
          error: error instanceof Error ? error.message : "Unable to calculate biological age."
        });
      });
    return () => { cancelled = true; };
  }, [tab, bootstrap?.profile.id]);

  async function submitQuery(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = question.trim();
    if (!prompt || queryBusy) return;
    if (queryTurns.length >= maxConversationTurns) {
      onNotice("This conversation has reached 25 questions. Start a new conversation to continue.");
      return;
    }
    const consent = bootstrap?.profile.cloudAiConsent;
    const cloudEnabled = consent?.enabled === true && consent.providerScopeAccepted === true;
    if (llmConfig?.provider === "openai" && !cloudEnabled) {
      setQueryTurns((current) => [...current, {
        id: `query-turn-${++queryTurnIdRef.current}`,
        question: prompt,
        status: "error",
        error: {
          code: "CLOUD_CONSENT_REQUIRED",
          message: "Cloud model prompts are disabled. Open provider details to enable cloud prompts."
        }
      }]);
      return;
    }

    const turnId = `query-turn-${++queryTurnIdRef.current}`;
    const generation = ++queryGenerationRef.current;
    const controller = new AbortController();
    queryAbortRef.current?.abort();
    queryAbortRef.current = controller;
    setQueryTurns((current) => [...current, { id: turnId, question: prompt, status: "pending" }]);
    setQuestion("");
    try {
      const data = await api.query.ai(prompt, {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        debug: true,
        context: queryContext,
        signal: controller.signal
      });
      if (generation !== queryGenerationRef.current) return;
      setQueryTurns((current) => current.map((turn) => (
        turn.id === turnId ? { ...turn, status: "answered", result: data } : turn
      )));
      setQueryContext(data.context);
    } catch (error) {
      if (controller.signal.aborted || generation !== queryGenerationRef.current) return;
      setQueryTurns((current) => current.map((turn) => (
        turn.id === turnId ? { ...turn, status: "error", error: queryFailureFrom(error) } : turn
      )));
    } finally {
      if (queryAbortRef.current === controller) queryAbortRef.current = null;
    }
  }

  function startNewConversation() {
    queryGenerationRef.current += 1;
    queryAbortRef.current?.abort();
    queryAbortRef.current = null;
    setQueryTurns([]);
    setQueryContext(undefined);
    setQuestion("");
    document.getElementById("ai-question")?.focus();
  }

  async function setCloudConsent(enabled: boolean) {
    setConsentBusy(true);
    try {
      const payload: CloudAiConsent = {
        enabled,
        providerScopeAccepted: enabled,
        consentVersion: "v1"
      };
      await api.cloudAiConsent.set(payload);
      await onDataChanged();
      onNotice(enabled ? "Cloud prompt consent enabled." : "Cloud prompt consent disabled.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not update cloud consent.");
    } finally {
      setConsentBusy(false);
    }
  }

  async function generateInsight() {
    setReviewBusy(true);
    try {
      const config = llmConfig ?? await api.llm.config();
      const consent = bootstrap?.profile.cloudAiConsent;
      const cloudEnabled = consent?.enabled === true && consent.providerScopeAccepted === true;
      if (config.provider === "openai" && !cloudEnabled) {
        setConsentDialogOpen(true);
        return;
      }
      await api.generateInsight();
      await onDataChanged();
      onNotice("Insight generated from local data.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unexpected local error.");
    } finally {
      setReviewBusy(false);
    }
  }

  async function acceptCloudConsent() {
    setConsentDialogOpen(false);
    setReviewBusy(true);
    try {
      const consent: CloudAiConsent = {
        enabled: true,
        providerScopeAccepted: true,
        consentVersion: "v1"
      };
      await api.cloudAiConsent.set(consent);
      await api.generateInsight();
      await onDataChanged();
      onNotice("Insight generated using the configured AI model.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not enable cloud AI insights.");
    } finally {
      setReviewBusy(false);
    }
  }

  return (
    <section className="insights-shell">
      <div className="insights-header">
        <div>
          <h1>Insights</h1>
        </div>
      </div>
      <div className="insights-workspace">
        <div className="insights-tabs" role="tablist" aria-label="Insight tools">
          <button
            id="insight-tab-biological-age"
            type="button"
            role="tab"
            aria-controls="insight-panel-biological-age"
            aria-selected={tab === "biological-age"}
            className={tab === "biological-age" ? "active" : ""}
            tabIndex={tab === "biological-age" ? 0 : -1}
            onKeyDown={(event) => handleTabKeyDown(event, "biological-age")}
            onClick={() => onTabChange("biological-age")}
          >
            Biological Age
          </button>
          <button
            id="insight-tab-ai-query"
            type="button"
            role="tab"
            aria-controls="insight-panel-ai-query"
            aria-selected={tab === "ai-query"}
            className={tab === "ai-query" ? "active" : ""}
            tabIndex={tab === "ai-query" ? 0 : -1}
            onKeyDown={(event) => handleTabKeyDown(event, "ai-query")}
            onClick={() => onTabChange("ai-query")}
          >
            AI Query
          </button>
          <button
            id="insight-tab-ai-review"
            type="button"
            role="tab"
            aria-controls="insight-panel-ai-review"
            aria-selected={tab === "ai-review"}
            className={tab === "ai-review" ? "active" : ""}
            tabIndex={tab === "ai-review" ? 0 : -1}
            onKeyDown={(event) => handleTabKeyDown(event, "ai-review")}
            onClick={() => onTabChange("ai-review")}
          >
            AI Review
          </button>
        </div>
        {tab === "biological-age" ? (
          <div id="insight-panel-biological-age" role="tabpanel" aria-labelledby="insight-tab-biological-age">
            <BiologicalAgePage report={biologicalAge.data} loading={biologicalAge.busy} error={biologicalAge.error} />
          </div>
        ) : tab === "ai-query" ? (
          <div id="insight-panel-ai-query" role="tabpanel" aria-labelledby="insight-tab-ai-query">
            <QueryPage
              question={question}
              onQuestionChange={setQuestion}
              onSubmit={submitQuery}
              busy={queryBusy}
              turns={queryTurns}
              maxTurns={maxConversationTurns}
              onNewConversation={startNewConversation}
              cloudProvider={llmConfig?.provider}
              cloudConsent={bootstrap?.profile.cloudAiConsent}
              cloudConsentBusy={consentBusy}
              onCloudConsentChange={(enabled) => { void setCloudConsent(enabled); }}
            />
          </div>
        ) : (
          <div id="insight-panel-ai-review" role="tabpanel" aria-labelledby="insight-tab-ai-review">
            <AiReviewPage
              busy={reviewBusy}
              latestInsight={bootstrap?.latestInsight}
              onGenerateInsight={() => { void generateInsight(); }}
            />
          </div>
        )}
      </div>
      <ConfirmDialog
        open={consentDialogOpen}
        title="Allow cloud AI insights?"
        description="Vitana will send the anonymized health data needed for this review to your configured cloud AI provider. You can disable cloud prompts later in Insights."
        cancelLabel="Not now"
        confirmLabel="Allow and generate"
        onConfirm={() => { void acceptCloudConsent(); }}
        onCancel={() => setConsentDialogOpen(false)}
      />
    </section>
  );
}

function queryFailureFrom(error: unknown): QueryFailure {
  if (error instanceof ApiError) {
    const parsed = aiQueryErrorResponseSchema.safeParse(error.details);
    if (parsed.success) {
      return {
        message: parsed.data.error,
        code: parsed.data.code,
        suggestions: parsed.data.suggestions,
        suggestedRephrase: parsed.data.suggestedRephrase,
        diagnostics: parsed.data.diagnostics,
        correlationId: parsed.data.correlationId ?? error.correlationId
      };
    }
    if (error.code === "CLOUD_CONSENT_REQUIRED") {
      return {
        code: error.code,
        message: "Cloud consent is required before off-device prompt processing. Open provider details to enable cloud prompts.",
        correlationId: error.correlationId
      };
    }
    return { message: error.message, code: error.code, correlationId: error.correlationId };
  }
  return { message: error instanceof Error ? error.message : "Query failed." };
}
