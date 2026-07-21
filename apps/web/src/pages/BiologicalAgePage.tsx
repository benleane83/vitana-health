import type { BiologicalAgeReport } from "@vitana/shared";
import { formatTimestamp } from "../utils.js";

function formatAge(value: number | undefined): string {
  return value === undefined ? "—" : `${value.toFixed(1)} years`;
}

function describeAgeDifference(value: number | undefined): string {
  if (value === undefined) return "The difference could not be calculated.";
  if (Math.abs(value) < 0.05) return "The estimate is aligned with chronological age.";
  return `The estimate is ${Math.abs(value).toFixed(1)} years ${value < 0 ? "below" : "above"} chronological age.`;
}

export function BiologicalAgePage({
  report,
  loading,
  error
}: {
  report?: BiologicalAgeReport;
  loading: boolean;
  error?: string;
}) {
  return (
    <section className="panel summary-panel biological-age-page">
      <div className="summary-header">
        <div>
          <h2>Biological Age</h2>
          <p>A deterministic wellness estimate based on chronological age and selected laboratory markers.</p>
        </div>
      </div>
      <div aria-live="polite" aria-atomic="true">
        {loading ? <p className="empty" role="status">Calculating biological age…</p> : null}
        {error ? <p className="empty" role="alert">{error}</p> : null}
      </div>
      {report ? <p className="biological-age-disclaimer">{report.disclaimer}</p> : null}
      {report?.models.map((model) => {
        const usedInputCount = model.inputs.filter((input) => input.status === "used").length;
        const evidenceSummary = model.inputs.length > 0
          ? `${usedInputCount} of ${model.inputs.length} required markers are usable for this estimate.`
          : model.status === "available"
            ? "The required evidence is available for this estimate."
            : "Required evidence is not yet available for this estimate.";

        return (
        <section className="summary-category biological-age-model" key={model.id}>
          <div className="summary-category-toggle">
            <div className="biological-age-model-heading">
              <h3>{model.name} <span className="summary-readonly">({model.version})</span></h3>
              <p>{model.methodology}</p>
            </div>
            <span className={`biological-age-readiness ${model.status === "available" ? "is-ready" : "needs-data"}`}>
              {model.status === "available" ? "Ready to review" : model.status === "incomplete" ? "Needs more data" : "Not available"}
            </span>
          </div>

          <div className="biological-age-evidence" aria-labelledby={`${model.id}-evidence-heading`}>
            <div>
              <h4 id={`${model.id}-evidence-heading`}>Evidence readiness</h4>
              <p>{evidenceSummary}</p>
            </div>
            <dl className="biological-age-evidence-facts">
              <div>
                <dt>Lab evidence</dt>
                <dd>{model.panelCollectedAt ? formatTimestamp(model.panelCollectedAt) : "No usable panel date"}</dd>
              </div>
              <div>
                <dt>Required markers</dt>
                <dd>{model.inputs.length > 0 ? `${usedInputCount} usable / ${model.inputs.length} required` : "Not reported"}</dd>
              </div>
              <div>
                <dt>Age basis</dt>
                <dd>{model.chronologicalAgeDetail ?? "Chronological age is not available."}</dd>
              </div>
            </dl>
            {model.limitations.length > 0 ? (
              <div className="biological-age-context">
                <strong>Important context</strong>
                <ul>{model.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
              </div>
            ) : null}
          </div>

          <div className="summary-detail-table biological-age-details">
            {model.status === "available" ? (
              <section className="biological-age-result" aria-labelledby={`${model.id}-result-heading`}>
                <h4 id={`${model.id}-result-heading`}>What the estimate shows</h4>
                <p className="biological-age-interpretation">{describeAgeDifference(model.ageAcceleration)}</p>
                <div className="biological-age-comparison">
                  <div><span>Chronological age</span><strong>{formatAge(model.chronologicalAge)}</strong></div>
                  <div><span>Estimated biological age</span><strong>{formatAge(model.biologicalAge)}</strong></div>
                </div>
                <p className="summary-detail-hint">The difference describes this model output; it is not a diagnosis, prognosis, or measure of overall health.</p>
              </section>
            ) : null}
            {model.inputs.length > 0 ? (
              <details className="biological-age-inputs" open={model.status !== "available"}>
                <summary>Review required inputs ({model.inputs.length})</summary>
                <div className="query-table-scroll">
                  <table>
                    <caption className="sr-only">{model.name} required inputs</caption>
                    <thead><tr><th scope="col">Marker</th><th scope="col">Status</th><th scope="col">Selected value</th><th scope="col">Required unit</th></tr></thead>
                    <tbody>
                      {model.inputs.map((input) => (
                        <tr key={input.code}>
                          <td data-label="Marker">{input.label}</td>
                          <td data-label="Status">{input.status === "used" ? "Used" : input.status === "missing" ? "Missing" : "Invalid"}</td>
                          <td data-label="Selected value">{input.value === undefined ? input.detail ?? "—" : `${input.value} ${input.unit ?? ""}`}</td>
                          <td data-label="Required unit">{input.normalizedUnit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ) : null}
            <div className="biological-age-method">
              <h4>Method reference</h4>
              <p className="summary-detail-hint">{model.citation}</p>
            </div>
          </div>
        </section>
      );})}
    </section>
  );
}
