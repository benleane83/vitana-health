import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { aiQueryErrorResponseSchema, type AppBootstrap, type BiologicalAgeReport, type CloudAiConsent } from "@vitana/shared";
import { api, ApiError, type AiQueryResult, type LlmConfig } from "../../api.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { AiReviewPage } from "../../pages/AiReviewPage.js";
import { BiologicalAgePage } from "../../pages/BiologicalAgePage.js";
import { QueryPage, type QueryFailure } from "../../pages/QueryPage.js";
import type { InsightsTab } from "../../types.js";

type RemoteState<T, TError = string> = {
  data?: T;
  busy: boolean;
  error?: TError;
};

const insightTabs: InsightsTab[] = ["biological-age", "ai-query", "ai-review"];

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
  const [query, setQuery] = useState<RemoteState<AiQueryResult, QueryFailure>>({ busy: false });
  const [question, setQuestion] = useState("");
  const [llmConfig, setLlmConfig] = useState<LlmConfig>();
  const [consentBusy, setConsentBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [consentDialogOpen, setConsentDialogOpen] = useState(false);

  useEffect(() => {
    void api.llm.config().then(setLlmConfig).catch(() => setLlmConfig(undefined));
  }, []);

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
    if (!prompt) return;
    const consent = bootstrap?.profile.cloudAiConsent;
    const cloudEnabled = consent?.enabled === true && consent.providerScopeAccepted === true;
    if (llmConfig?.provider === "openai" && !cloudEnabled) {
      setQuery({
        busy: false,
        error: {
          code: "CLOUD_CONSENT_REQUIRED",
          message: "Cloud model prompts are disabled. Open provider details to enable cloud prompts."
        }
      });
      return;
    }
    setQuery({ busy: true });
    try {
      const data = await api.query.ai(prompt, {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        debug: true
      });
      setQuery({ data, busy: false });
    } catch (error) {
      setQuery({ busy: false, error: queryFailureFrom(error) });
    }
  }

  async function setCloudConsent(enabled: boolean) {
    setConsentBusy(true);
    setQuery((current) => ({ ...current, error: undefined }));
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
      setQuery((current) => ({
        ...current,
        error: { message: error instanceof Error ? error.message : "Could not update cloud consent." }
      }));
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
              busy={query.busy}
              cloudProvider={llmConfig?.provider}
              cloudConsent={bootstrap?.profile.cloudAiConsent}
              cloudConsentBusy={consentBusy}
              onCloudConsentChange={(enabled) => { void setCloudConsent(enabled); }}
              result={query.data}
              error={query.error}
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
