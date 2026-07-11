import type { AnalyticsSummary, Insight, Profile } from "@local-fitness-advisor/shared";
import { safetyNotice } from "@local-fitness-advisor/shared";
import { MiniChart, DensityBar } from "../components/Charts.js";
import { formatProfileSex } from "../utils.js";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <strong aria-label={`${label}: ${value}`}>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function InsightCard({ insight }: { insight?: Insight }) {
  if (!insight) {
    return <p className="empty">Generate an insight after importing data.</p>;
  }
  return (
    <div className="insight">
      <span>{insight.model} / confidence {insight.confidence}</span>
      <h3>{insight.title}</h3>
      <p>{insight.body}</p>
    </div>
  );
}

export function DashboardPage({
  store,
  analytics,
  density,
  busy,
  latestInsight,
  profile,
  activeProfile,
  onEditProfile,
  onManageProfiles,
  onNavigateSummary,
  onGenerateInsight
}: {
  store?: { sourceImports: unknown[] };
  analytics?: AnalyticsSummary;
  density: number;
  busy: boolean;
  latestInsight?: Insight;
  profile?: Profile;
  activeProfile?: { displayName?: string };
  onEditProfile: () => void;
  onManageProfiles: () => void;
  onNavigateSummary: () => void;
  onGenerateInsight: () => void;
}) {
  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">Private health intelligence / local only</p>
          <h1>Your body data, held close.</h1>
          <p className="hero-copy">
            A local insights portal for your Android Health exports, activities, profile, and personal AI summaries.
          </p>
        </div>
        <div className="privacy-card">
          <span className="pulse" aria-hidden="true" />
          <strong>Encrypted local vault</strong>
          <p>{store?.sourceImports.length ?? 0} imports. Raw files stay off cloud services.</p>
          <DensityBar density={density} />
        </div>
      </section>

      <section className="grid">
        <article className="panel profile-panel">
          <div className="panel-heading-row">
            <h2>Profile context</h2>
            <button type="button" onClick={onEditProfile}>Edit</button>
          </div>
          <dl className="profile-summary">
            <div><dt>Name</dt><dd>{profile?.displayName ?? "Local user"}</dd></div>
            <div><dt>Birth year</dt><dd>{profile?.birthYear ?? "Not set"}</dd></div>
            <div><dt>Sex</dt><dd>{formatProfileSex(profile?.sex)}</dd></div>
            <div><dt>Height</dt><dd>{profile?.heightCm ? `${profile.heightCm} cm` : "Not set"}</dd></div>
            <div><dt>Units</dt><dd>{profile?.units === "imperial" ? "Imperial" : "Metric"}</dd></div>
          </dl>
          <div className="profile-goals">
            <span>Current focus</span>
            <p>{profile?.goalSummary || "Improve energy, sleep, and metabolic health."}</p>
          </div>
        </article>

        <article className="panel metrics-panel">
          <div className="panel-heading-row">
            <h2>Local analytics</h2>
            <button type="button" onClick={onNavigateSummary}>View summary</button>
          </div>
          <div className="stat-row">
            <Stat label="Imports" value={analytics?.counts.imports ?? 0} />
            <Stat label="Observations" value={analytics?.counts.observations ?? 0} />
            <Stat label="Samples" value={analytics?.counts.samples ?? 0} />
            <Stat label="Activities" value={analytics?.counts.activities ?? 0} />
          </div>
          <div className="metric-list" aria-label="Latest metrics">
            {analytics?.latestMetrics.length
              ? analytics.latestMetrics.map((metric) => (
                  <div className="metric" key={metric.code}>
                    <span>{metric.label}</span>
                    <strong>{metric.value} {metric.unit}</strong>
                    <em data-status={metric.status}>{metric.status}</em>
                  </div>
                ))
              : <p className="empty">Import data to populate latest metrics.</p>}
          </div>
        </article>

        <article className="panel trends-panel">
          <h2>Trend traces</h2>
          {analytics?.trendCards.length
            ? analytics.trendCards.map((card) => (
                <div className="trend" key={card.code}>
                  <div>
                    <strong>{card.label}</strong>
                    <span>{card.summary}</span>
                  </div>
                  <MiniChart label={card.label} points={card.points} />
                </div>
              ))
            : <p className="empty">Two or more dated readings are needed for trend traces.</p>}
        </article>

        <article className="panel insight-panel">
          <h2>Guarded AI review</h2>
          <p className="safety">{safetyNotice}</p>
          <button disabled={busy} onClick={onGenerateInsight}>Generate local insight</button>
          <InsightCard insight={latestInsight} />
        </article>

        <article className="panel alerts-panel">
          <h2>Lab range review</h2>
          {analytics?.labAlerts.length
            ? analytics.labAlerts.map((alert) => (
                <div className="alert" key={`${alert.marker}-${alert.value}`}>
                  <span>{alert.marker}</span>
                  <strong>{alert.value} {alert.unit}</strong>
                  <em>{alert.flag}{alert.reference ? ` / ref ${alert.reference}` : ""}</em>
                </div>
              ))
            : <p className="empty">No out-of-range lab markers yet.</p>}
        </article>
      </section>
    </>
  );
}
