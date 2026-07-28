import type { AiQueryErrorResponse, CloudAiConsent } from "@vitana/shared";
import { safetyNotice } from "@vitana/shared";
import type { AiQueryResult } from "../api.js";
import { QueryChart } from "../components/Charts.js";

export interface QueryFailure {
  message: string;
  code?: string;
  suggestions?: string[];
  suggestedRephrase?: string;
  diagnostics?: AiQueryErrorResponse["diagnostics"];
  correlationId?: string;
}

export function QueryPage({
  question,
  onQuestionChange,
  onSubmit,
  busy,
  cloudProvider,
  cloudConsent,
  cloudConsentBusy,
  onCloudConsentChange,
  result,
  error
}: {
  question: string;
  onQuestionChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  busy: boolean;
  cloudProvider?: "ollama" | "openai";
  cloudConsent?: CloudAiConsent;
  cloudConsentBusy: boolean;
  onCloudConsentChange: (enabled: boolean) => void;
  result?: AiQueryResult;
  error?: QueryFailure;
}) {
  const cloudEnabled = cloudConsent?.enabled === true && cloudConsent?.providerScopeAccepted === true;
  const providerLabel = cloudProvider === "openai" ? "Cloud model" : "Local model";

  return (
    <section className="panel query-panel">
      <div>
        <p className="eyebrow">AI-powered natural language query</p>
        <h2>Ask about your health data</h2>
      </div>
      <p className="safety">{safetyNotice}</p>

      <form className="query-form" onSubmit={onSubmit}>
        <label htmlFor="ai-question">Question</label>
        <div className="query-composer">
          <textarea
            id="ai-question"
            value={question}
            rows={3}
            maxLength={500}
            onChange={(event) => onQuestionChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Ask about a metric, activity, health event, or care item"
            disabled={busy}
            aria-keyshortcuts="Enter"
            aria-describedby={`ai-query-shortcut ${error ? "ai-query-error" : "ai-query-provider"}`}
          />
          <button disabled={busy || !question.trim()} type="submit">
            {busy ? "Querying…" : "Ask"}
          </button>
        </div>
        <span className="sr-only" id="ai-query-shortcut">Press Enter to submit. Press Shift and Enter for a new line.</span>
      </form>

      <details className="query-provider" id="ai-query-provider">
        <summary>
          <span className={`query-provider-badge ${cloudProvider === "openai" ? "cloud" : "local"}`}>
            {providerLabel}
          </span>
          {cloudProvider === "openai" ? "Minimized prompts may leave this device" : "Prompts stay on this device"}
        </summary>
        {cloudProvider === "openai" ? (
          <div className="query-provider-body">
            <p>Profile identity, file names, notes, raw imports, and authentication tokens are excluded.</p>
            <div className="query-privacy-actions">
              <button
                type="button"
                onClick={() => onCloudConsentChange(!cloudEnabled)}
                disabled={cloudConsentBusy || busy}
              >
                {cloudConsentBusy ? "Saving…" : cloudEnabled ? "Disable cloud prompts" : "Enable cloud prompts"}
              </button>
              <span>{cloudEnabled ? "Cloud prompts enabled" : "Cloud prompts disabled"}</span>
            </div>
          </div>
        ) : null}
      </details>

      <div className="query-examples" aria-label="Query examples">
        <span>Try: </span>
        {["max daily steps this month", "average heart rate last month", "top exercises this month"].map(
          (example) => (
            <button
              key={example}
              className="query-example-chip"
              type="button"
              onClick={() => onQuestionChange(example)}
              aria-label={`Use example: ${example}`}
            >
              {example}
            </button>
          )
        )}
      </div>

      {/* Live region for query status */}
      <div aria-live="polite" aria-atomic="true">
        {busy ? <p className="empty" role="status">Querying your health data…</p> : null}
        {error ? <QueryError error={error} onQuestionChange={onQuestionChange} /> : null}
      </div>

      {result ? <QueryResult result={result} /> : null}
    </section>
  );
}

function QueryError({ error, onQuestionChange }: { error: QueryFailure; onQuestionChange: (value: string) => void }) {
  const actions = error.suggestedRephrase
    ? [error.suggestedRephrase, ...(error.suggestions ?? [])]
    : error.suggestions ?? [];
  return (
    <section className="query-error" id="ai-query-error" role="alert">
      <h3>{error.code === "QUERY_UNSUPPORTED" ? "That question is not supported yet" : "We could not run that question"}</h3>
      <p>{error.message}</p>
      {actions.length > 0 ? (
        <div className="query-recovery-actions">
          {actions.map((action) => (
            <button key={action} type="button" onClick={() => onQuestionChange(action)}>{action}</button>
          ))}
        </div>
      ) : null}
      {error.diagnostics || error.correlationId ? (
        <details className="query-technical-details">
          <summary>Technical details</summary>
          {error.correlationId ? <p>Reference: {error.correlationId}</p> : null}
          {error.diagnostics ? <pre>{JSON.stringify(error.diagnostics, null, 2)}</pre> : null}
        </details>
      ) : null}
    </section>
  );
}

function QueryResult({ result }: { result: AiQueryResult }) {
  const noData = result.outcome === "no_data";

  return (
    <div className="query-result" aria-live="polite" aria-atomic="false">
      <div className={`query-answer${noData ? " no-data" : ""}`}>
        <h3>{noData ? "No matching data" : "Answer"}</h3>
        <p>{result.answer}</p>
        {result.suggestedRephrase ? (
          <p className="query-rephrase"><em>Suggestion: {result.suggestedRephrase}</em></p>
        ) : null}
      </div>

      <div className="query-meta">
        {result.resolvedTimeRange ? (
          <span>Time range: <strong>{result.resolvedTimeRange.label}</strong></span>
        ) : null}
        {result.rowCount !== undefined ? (
          <span>Rows: <strong>{result.rowCount}</strong></span>
        ) : null}
      </div>

      {result.chart && result.chart.series.length > 0 ? (
        <div className="query-chart">
          <h3>Chart</h3>
          <QueryChart chart={result.chart} />
        </div>
      ) : null}

      {result.rows.length > 0 ? (
        <div className="query-table">
          <h3>Data preview</h3>
          <div className="query-table-scroll">
            <table>
              <caption className="sr-only">Query result data</caption>
              <thead>
                <tr>
                  {Object.keys(result.rows[0]).map((key) => (
                    <th key={key} scope="col">{key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.slice(0, 20).map((row, idx) => (
                  <tr key={idx}>
                    {Object.values(row).map((cell, cidx) => (
                      <td key={cidx}>{cell === null || cell === undefined ? "—" : String(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <details className="query-technical-details">
        <summary>Technical details</summary>
        <div className="query-technical-body">
          {result.limitations.length > 0 ? (
            <ul>
              {result.limitations.map((lim, idx) => <li key={idx}>{lim}</li>)}
            </ul>
          ) : null}
          {result.assumptions.length > 0 ? (
            <ul>
              {result.assumptions.map((assumption, idx) => <li key={idx}>Assumed: {assumption}</li>)}
            </ul>
          ) : null}
          {result.plan ? <pre>{JSON.stringify(result.plan, null, 2)}</pre> : null}
          {result.sql ? <pre>{result.sql}</pre> : null}
          {result.modelError ? <p>Summary fallback: {result.modelError}</p> : null}
          {result.debug ? <pre>{JSON.stringify(result.debug, null, 2)}</pre> : null}
        </div>
      </details>
    </div>
  );
}
