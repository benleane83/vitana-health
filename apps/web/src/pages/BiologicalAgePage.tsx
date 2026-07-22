import type { BiologicalAgeInput, BiologicalAgeReport } from "@vitana/shared";

const inputCategories: Record<string, string> = {
  albumin: "Liver function / metabolic panel",
  creatinine: "Kidney function / metabolic panel",
  glucose: "Glucose / metabolic panel",
  high_sensitivity_c_reactive_protein: "Inflammation",
  lymphocyte_percentage: "Complete blood count",
  mean_corpuscular_volume: "Complete blood count",
  red_cell_distribution_width: "Complete blood count",
  alkaline_phosphatase: "Liver function / metabolic panel",
  white_blood_cell_count: "Complete blood count"
};

function formatAge(value: number | undefined): string {
  return value === undefined ? "—" : `${value.toFixed(1)} years`;
}

function describeAgeDifference(value: number | undefined): string {
  if (value === undefined) return "The difference could not be calculated.";
  if (Math.abs(value) < 0.05) return "The estimate is aligned with chronological age.";
  return `The estimate is ${Math.abs(value).toFixed(1)} years ${value < 0 ? "below" : "above"} chronological age.`;
}

function inputStatus(input: BiologicalAgeInput): "Used" | "Missing" | "Unusable" {
  if (input.status === "used") return "Used";
  return input.status === "missing" ? "Missing" : "Unusable";
}

function savedValue(input: BiologicalAgeInput): string {
  if (input.status === "missing") return "No saved result found.";
  if (input.value === undefined) return input.detail ?? "No usable result found.";
  return `${input.value} ${input.unit ?? ""}`.trim();
}

function addResultHref(input: BiologicalAgeInput): string {
  const query = new URLSearchParams({ group: "Lab", marker: input.code });
  return `/import/manual?${query.toString()}`;
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
      <header className="summary-header">
        <div>
          <h2>Biological Age</h2>
          <p>A wellness estimate based on your chronological age and selected laboratory markers.</p>
        </div>
      </header>
      <div aria-live="polite" aria-atomic="true">
        {loading ? <p className="empty" role="status">Calculating biological age…</p> : null}
        {error ? <p className="empty" role="alert">{error}</p> : null}
      </div>

      {report?.models.map((model) => {
        const incompleteInputs = model.inputs.filter((input) => input.status !== "used");
        const statusLabel = model.status === "available"
          ? "Ready"
          : model.status === "incomplete"
            ? "Needs more data"
            : "Not available";

        return (
          <section className="summary-category biological-age-model" key={model.id}>
            <div className="biological-age-model-heading">
              <h3>{model.name}</h3>
              <p>{model.methodology}</p>
              <a
                className="biological-age-research-link"
                href="https://journals.plos.org/plosmedicine/article?id=10.1371/journal.pmed.1002718"
                target="_blank"
                rel="noreferrer"
              >
                Read the scientific research
              </a>
            </div>

            <section className="biological-age-inputs" aria-labelledby={`${model.id}-inputs-heading`}>
              <div className="biological-age-inputs-heading">
                <h4 id={`${model.id}-inputs-heading`}>Review required inputs ({model.inputs.length})</h4>
                <span className={`biological-age-readiness ${model.status === "available" ? "is-ready" : "needs-data"}`}>
                  {statusLabel}
                </span>
              </div>
              {incompleteInputs.length > 0 ? (
                <p className="biological-age-missing-summary">
                  Missing or unusable ({incompleteInputs.length}): {incompleteInputs.map((input) => input.label).join(", ")}.
                </p>
              ) : null}
              <div className="query-table-scroll">
                <table>
                  <caption className="sr-only">{model.name} required inputs</caption>
                  <thead>
                    <tr>
                      <th scope="col">Marker</th>
                      <th scope="col">Status</th>
                      <th scope="col">Current / selected value</th>
                      <th scope="col">Required unit</th>
                      <th scope="col">Blood test category</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.inputs.map((input) => (
                      <tr key={input.code}>
                        <td data-label="Marker">{input.label}</td>
                        <td data-label="Status">
                          <span className={`biological-age-input-status is-${input.status}`}>
                            {inputStatus(input)}
                          </span>
                        </td>
                        <td data-label="Current / selected value">{savedValue(input)}</td>
                        <td data-label="Required unit">{input.normalizedUnit}</td>
                        <td data-label="Blood test category">{inputCategories[input.code] ?? "Lab results"}</td>
                        <td data-label="Action">
                          {input.status === "used" ? "—" : (
                            <a className="biological-age-add-result" href={addResultHref(input)}>
                              Add result
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {model.status === "available" ? (
              <section className="biological-age-result" aria-labelledby={`${model.id}-result-heading`}>
                <h4 id={`${model.id}-result-heading`}>What the estimate shows</h4>
                <p className="biological-age-interpretation">{describeAgeDifference(model.ageAcceleration)}</p>
                <div className="biological-age-comparison">
                  <div><span>Chronological age</span><strong>{formatAge(model.chronologicalAge)}</strong></div>
                  <div><span>Estimated biological age</span><strong>{formatAge(model.biologicalAge)}</strong></div>
                </div>
              </section>
            ) : null}
          </section>
        );
      })}

      {report ? (
        <section className="biological-age-disclaimer" aria-labelledby="biological-age-disclaimer-heading">
          <h3 id="biological-age-disclaimer-heading">Important information</h3>
          <p>{report.disclaimer}</p>
        </section>
      ) : null}
    </section>
  );
}
