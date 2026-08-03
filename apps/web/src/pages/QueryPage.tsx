import type { AiQueryErrorResponse, CloudAiConsent } from "@vitana/shared";
import { safetyNotice } from "@vitana/shared";
import { RotateCcw } from "lucide-react";
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

export interface QueryTurn {
  id: string;
  question: string;
  status: "pending" | "answered" | "error";
  result?: AiQueryResult;
  error?: QueryFailure;
}

export function QueryPage({
  question,
  onQuestionChange,
  onSubmit,
  busy,
  turns,
  maxTurns,
  onNewConversation,
  cloudProvider,
  cloudConsent,
  cloudConsentBusy,
  onCloudConsentChange
}: {
  question: string;
  onQuestionChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  busy: boolean;
  turns: QueryTurn[];
  maxTurns: number;
  onNewConversation: () => void;
  cloudProvider?: "ollama" | "openai";
  cloudConsent?: CloudAiConsent;
  cloudConsentBusy: boolean;
  onCloudConsentChange: (enabled: boolean) => void;
}) {
  const cloudEnabled = cloudConsent?.enabled === true && cloudConsent?.providerScopeAccepted === true;
  const providerLabel = cloudProvider === "openai" ? "Cloud model" : "Local model";
  const latestTurn = turns[turns.length - 1];
  const atTurnLimit = turns.length >= maxTurns;
  const statusMessage = busy
    ? "Querying your health data."
    : latestTurn?.status === "answered"
      ? "Answer ready."
      : latestTurn?.status === "error" ? "The question could not be answered." : "";

  function usePrompt(prompt: string) {
    onQuestionChange(prompt);
    document.getElementById("ai-question")?.focus();
  }

  return (
    <section className="panel query-panel">
      <div className="query-header">
        <div>
          <p className="eyebrow">AI-powered natural language query</p>
          <h2>Ask about your health data</h2>
        </div>
        {turns.length > 0 ? (
          <button className="query-reset" type="button" onClick={onNewConversation}>
            <RotateCcw aria-hidden="true" size={16} />
            New conversation
          </button>
        ) : null}
      </div>
      <p className="safety">{safetyNotice}</p>

      <details className="query-provider" id="ai-query-provider">
        <summary>
          <span className={`query-provider-badge ${cloudProvider === "openai" ? "cloud" : "local"}`}>
            {providerLabel}
          </span>
          {cloudProvider === "openai" ? "Minimized prompts may leave this device" : "Prompts stay on this device"}
        </summary>
        {cloudProvider === "openai" ? (
          <div className="query-provider-body">
            <p>The current question and minimized structured context from the previous answer may leave this device. Profile identity, file names, notes, raw imports, and authentication tokens are excluded.</p>
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

      {turns.length === 0 ? <div className="query-examples" aria-label="Query examples">
        <span>Try: </span>
        {["max daily steps this month", "average heart rate last month", "lowest weight this year"].map(
          (example) => (
            <button
              key={example}
              className="query-example-chip"
              type="button"
              onClick={() => usePrompt(example)}
              aria-label={`Use example: ${example}`}
            >
              {example}
            </button>
          )
        )}
      </div> : null}

      {turns.length > 0 ? (
        <ol className="query-transcript" aria-label="AI Query conversation">
          {turns.map((turn, index) => {
            const latest = index === turns.length - 1;
            return (
              <li className="query-turn" key={turn.id}>
                <article className="query-user-turn">
                  <p className="query-speaker">You asked</p>
                  <p>{turn.question}</p>
                </article>
                <article className="query-assistant-turn">
                  <p className="query-speaker">AI summary</p>
                  {turn.status === "pending" ? <p className="query-pending">Querying your health data…</p> : null}
                  {turn.error ? <QueryError error={turn.error} onQuestionChange={usePrompt} /> : null}
                  {turn.result ? <QueryResult result={turn.result} latest={latest} /> : null}
                  {latest && turn.result?.suggestedFollowUps.length ? (
                    <div className="query-follow-ups" aria-label="Suggested follow-up questions">
                      <span>Ask next:</span>
                      {turn.result.suggestedFollowUps.map((followUp) => (
                        <button key={followUp} type="button" onClick={() => usePrompt(followUp)}>{followUp}</button>
                      ))}
                    </div>
                  ) : null}
                </article>
              </li>
            );
          })}
        </ol>
      ) : null}

      <form className="query-form" onSubmit={onSubmit}>
        <label htmlFor="ai-question">{turns.length > 0 ? "Ask a follow-up" : "Question"}</label>
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
            placeholder={atTurnLimit ? "Start a new conversation to continue" : "Ask about a metric, activity, health event, or care item"}
            disabled={busy || atTurnLimit}
            aria-keyshortcuts="Enter"
            aria-describedby="ai-query-shortcut ai-query-provider"
          />
          <button disabled={busy || atTurnLimit || !question.trim()} type="submit">
            {busy ? "Querying…" : "Ask"}
          </button>
        </div>
        <span className="sr-only" id="ai-query-shortcut">Press Enter to submit. Press Shift and Enter for a new line.</span>
        {atTurnLimit ? <p className="query-limit">Start a new conversation to ask more questions.</p> : null}
      </form>
      <p className="sr-only" aria-live="polite" aria-atomic="true">{statusMessage}</p>
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

function QueryResult({ result, latest }: { result: AiQueryResult; latest: boolean }) {
  const noData = result.outcome === "no_data";
  const hasEvidence = result.rows.length > 0 || !!result.chart;

  return (
    <div className="query-result">
      <div className={`query-answer${noData ? " no-data" : ""}`}>
        {noData ? <h3>No matching data</h3> : null}
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

      {latest ? (
        <>
          {hasEvidence ? <QueryEvidence result={result} /> : null}
          <QueryTechnicalDetails result={result} />
        </>
      ) : (
        <details className="query-prior-evidence">
          <summary>View local data and details</summary>
          {hasEvidence ? <QueryEvidence result={result} /> : null}
          <QueryTechnicalBody result={result} />
        </details>
      )}
    </div>
  );
}

function QueryEvidence({ result }: { result: AiQueryResult }) {
  return (
    <div className="query-evidence">
      <h3>Local data</h3>
      {result.chart && result.chart.series.length > 0 ? (
        <div className="query-chart">
          <QueryChart chart={result.chart} />
        </div>
      ) : null}
      {result.rows.length > 0 ? (
        <div className="query-table">
          <div className="query-table-scroll">
            <table>
              <caption className="sr-only">Query result data</caption>
              <thead><tr>{Object.keys(result.rows[0]).map((key) => <th key={key} scope="col">{key}</th>)}</tr></thead>
              <tbody>{result.rows.slice(0, 20).map((row, rowIndex) => (
                <tr key={rowIndex}>{Object.values(row).map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell === null || cell === undefined ? "—" : String(cell)}</td>
                ))}</tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function QueryTechnicalDetails({ result }: { result: AiQueryResult }) {
  return <details className="query-technical-details"><summary>Technical details</summary><QueryTechnicalBody result={result} /></details>;
}

function QueryTechnicalBody({ result }: { result: AiQueryResult }) {
  return (
    <div className="query-technical-body">
      {result.limitations.length > 0 ? <ul>{result.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul> : null}
      {result.assumptions.length > 0 ? <ul>{result.assumptions.map((item, index) => <li key={index}>Assumed: {item}</li>)}</ul> : null}
      {result.plan ? <pre>{JSON.stringify(result.plan, null, 2)}</pre> : null}
      {result.sql ? <pre>{result.sql}</pre> : null}
      {result.modelError ? <p>Summary fallback: {result.modelError}</p> : null}
      {result.debug ? <pre>{JSON.stringify(result.debug, null, 2)}</pre> : null}
    </div>
  );
}
