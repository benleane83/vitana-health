import type { CloudAiConsent } from "@vitana/shared";
import { safetyNotice } from "@vitana/shared";
import type { AiQueryResult } from "../api.js";
import { QueryChart } from "../components/Charts.js";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <strong aria-label={`${label}: ${value}`}>{value}</strong>
      <span>{label}</span>
    </div>
  );
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
  error?: string;
}) {
  const cloudEnabled = cloudConsent?.enabled === true && cloudConsent?.providerScopeAccepted === true;
  const providerLabel = cloudProvider === "openai" ? "Cloud model" : "Local model";

  return (
    <section className="panel query-panel">
      <div>
        <p className="eyebrow">AI-powered natural language query</p>
        <h2>Ask your health data</h2>
      </div>
      <p className="safety">{safetyNotice}</p>

      <section className="query-privacy-card" aria-label="AI privacy and provider scope">
        <div className="query-privacy-head">
          <strong>{providerLabel}</strong>
          <span className={`query-provider-badge ${cloudProvider === "openai" ? "cloud" : "local"}`}>
            {cloudProvider === "openai" ? "Off-device prompt processing" : "On-device processing"}
          </span>
        </div>
        {cloudProvider === "openai" ? (
          <>
            <p>
              Only minimized model prompts may leave this device. Direct identifiers and raw import content are excluded.
            </p>
            <ul>
              <li>Sent: de-identified question + bounded metric evidence.</li>
              <li>Never sent: profile identity, source labels, file names, notes, raw imports, or auth tokens.</li>
            </ul>
            <div className="query-privacy-actions">
              <button
                type="button"
                onClick={() => onCloudConsentChange(!cloudEnabled)}
                disabled={cloudConsentBusy || busy}
              >
                {cloudConsentBusy
                  ? "Saving…"
                  : cloudEnabled
                    ? "Disable cloud prompts"
                    : "Enable cloud prompts"}
              </button>
              <span>
                {cloudEnabled
                  ? `Enabled${cloudConsent?.consentedAt ? ` (${cloudConsent.consentedAt.slice(0, 10)})` : ""}`
                  : "Cloud prompts disabled"}
              </span>
            </div>
          </>
        ) : (
          <p>Prompts stay local when using a local model provider.</p>
        )}
      </section>

      <form className="query-form" onSubmit={onSubmit}>
        <label htmlFor="ai-question">Question</label>
        <input
          id="ai-question"
          value={question}
          onChange={(event) => onQuestionChange(event.target.value)}
          placeholder="e.g. average heart rate last month"
          disabled={busy}
          aria-describedby={error ? "ai-query-error" : undefined}
        />
        <button disabled={busy || !question.trim()} type="submit">
          {busy ? "Querying…" : "Ask"}
        </button>
      </form>

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
        {error ? <p className="empty" id="ai-query-error" role="alert">{error}</p> : null}
      </div>

      {result ? <QueryResult result={result} /> : null}
    </section>
  );
}

function QueryResult({ result }: { result: AiQueryResult }) {
  const confidencePct = Math.round(result.confidence * 100);
  const confidenceLabel =
    result.confidence >= 0.8 ? "high" : result.confidence >= 0.5 ? "medium" : "low";

  return (
    <div className="query-result" aria-live="polite" aria-atomic="false">
      <div className="query-answer">
        <h3>Answer</h3>
        <p>{result.answer}</p>
        {result.suggestedRephrase ? (
          <p className="query-rephrase"><em>Suggestion: {result.suggestedRephrase}</em></p>
        ) : null}
      </div>

      <div className="query-meta">
        <span>
          Confidence:{" "}
          <strong data-level={confidenceLabel} aria-label={`Confidence: ${confidencePct}%, rated ${confidenceLabel}`}>
            {confidencePct}%
          </strong>
        </span>
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

      {result.sql ? (
        <details className="query-sql">
          <summary>Generated SQL</summary>
          <pre>{result.sql}</pre>
        </details>
      ) : null}

      {result.limitations.length > 0 ? (
        <details className="query-limitations" open>
          <summary>Limitations &amp; notes</summary>
          <ul>
            {result.limitations.map((lim, idx) => <li key={idx}>{lim}</li>)}
          </ul>
          {result.assumptions.length > 0 ? (
            <ul>
              {result.assumptions.map((a, idx) => <li key={idx}>Assumed: {a}</li>)}
            </ul>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}
