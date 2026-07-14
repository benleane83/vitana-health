import type { BiologicalAgeReport } from "@local-fitness-advisor/shared";
import { formatTimestamp } from "../utils.js";

function formatAge(value: number | undefined): string {
  return value === undefined ? "—" : `${value.toFixed(1)} years`;
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
    <section className="panel summary-panel">
      <div className="summary-header">
        <div>
          <p className="eyebrow">Deterministic wellness estimate</p>
          <h2>Biological Age</h2>
          <p>This page does not diagnose health conditions or provide medical advice.</p>
        </div>
      </div>
      <div aria-live="polite" aria-atomic="true">
        {loading ? <p className="empty" role="status">Calculating biological age…</p> : null}
        {error ? <p className="empty" role="alert">{error}</p> : null}
      </div>
      {report?.models.map((model) => (
        <section className="summary-category" key={model.id}>
          <div className="summary-category-toggle">
            <strong>{model.name} <span className="summary-readonly">({model.version})</span></strong>
            {model.status !== "available" ? <span>{model.status === "incomplete" ? "Incomplete data" : "Not available"}</span> : null}
          </div>
          <div className="summary-detail-table">
            <p>{model.methodology}</p>
            {model.status === "available" ? (
              <div className="summary-totals summary-detail-stats biological-age-stats">
                <div className="stat"><strong>{formatAge(model.chronologicalAge)}</strong><span>Chronological age</span></div>
                <div className="stat"><strong>{formatAge(model.biologicalAge)}</strong><span>Biological age</span></div>
                <div className="stat"><strong>{formatAge(model.ageAcceleration)}</strong><span>Age acceleration</span></div>
              </div>
            ) : null}
            {model.panelCollectedAt ? <p>Selected lab panel: <strong>{formatTimestamp(model.panelCollectedAt)}</strong></p> : null}
            {model.chronologicalAgeDetail ? <p>{model.chronologicalAgeDetail}</p> : null}
            {model.inputs.length > 0 ? (
              <table>
                <caption className="sr-only">{model.name} required inputs</caption>
                <thead><tr><th scope="col">Marker</th><th scope="col">Status</th><th scope="col">Selected value</th><th scope="col">Required unit</th></tr></thead>
                <tbody>
                  {model.inputs.map((input) => (
                    <tr key={input.code}>
                      <td>{input.label}</td>
                      <td>{input.status === "used" ? "Used" : input.status === "missing" ? "Missing" : "Invalid"}</td>
                      <td>{input.value === undefined ? input.detail ?? "—" : `${input.value} ${input.unit ?? ""}`}</td>
                      <td>{input.normalizedUnit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            <p className="summary-detail-hint">{model.limitations.join(" ")}</p>
            <p className="summary-detail-hint">Citation: {model.citation}</p>
          </div>
        </section>
      ))}
      {report ? <p className="summary-detail-hint">{report.disclaimer}</p> : null}
    </section>
  );
}
