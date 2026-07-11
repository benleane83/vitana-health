import { safetyNotice } from "@local-fitness-advisor/shared";

export function ExportPage({
  busy,
  error,
  hasHealthData,
  onDownload
}: {
  busy: boolean;
  error?: string;
  hasHealthData: boolean;
  onDownload: () => void;
}) {
  return (
    <section className="panel">
      <p className="eyebrow">Shareable health summary</p>
      <h2>Export PDF</h2>
      <p>
        Download a clinician-oriented report containing your profile details, health-data totals, latest measurements,
        flagged laboratory results, trends, and imported-source provenance.
      </p>
      <p className="summary-detail-hint">{safetyNotice}</p>
      {!hasHealthData ? (
        <p className="empty" role="status">No health data has been imported yet. The report will show that no records are available.</p>
      ) : null}
      <div aria-live="polite" aria-atomic="true">
        {error ? <p className="empty" role="alert">{error}</p> : null}
      </div>
      <button type="button" onClick={onDownload} disabled={busy}>
        {busy ? "Preparing PDF…" : "Download PDF report"}
      </button>
    </section>
  );
}
