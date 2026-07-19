import type { AnalyticsSummary, Insight, Profile } from "@local-fitness-advisor/shared";
import { safetyNotice } from "@local-fitness-advisor/shared";
import { MiniChart } from "../components/Charts.js";
import { MarkdownText } from "../components/MarkdownText.js";
import { formatBloodType, formatDetailValue, formatProfileSex, formatProfileType, formatShortTimestamp } from "../utils.js";

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
      <MarkdownText>{insight.body}</MarkdownText>
    </div>
  );
}

export function DashboardPage({
  importCount,
  analytics,
  busy,
  latestInsight,
  profile,
  activeProfile,
  onEditProfile,
  onManageProfiles,
  onNavigateSummary,
  onNavigateMeasurement,
  onGenerateInsight
}: {
  importCount: number;
  analytics?: AnalyticsSummary;
  busy: boolean;
  latestInsight?: Insight;
  profile?: Profile;
  activeProfile?: { displayName?: string };
  onEditProfile: () => void;
  onManageProfiles: () => void;
  onNavigateSummary: () => void;
  onNavigateMeasurement: (measurementCode: string) => void;
  onGenerateInsight: () => void;
}) {
  const latestObservedAt = analytics?.latestMetrics
    .map((metric) => metric.observedAt)
    .sort((left, right) => right.localeCompare(left))[0];

  return (
    <>
      <section className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <div className="vitara-lockup">
            <div className="vitara-mark" aria-hidden="true">
              <span className="vitara-petal vitara-petal-top" />
              <span className="vitara-petal vitara-petal-left" />
              <span className="vitara-petal vitara-petal-right" />
              <span className="vitara-stem" />
              <span className="vitara-core" />
            </div>
            <p className="vitara-wordmark">Vitara</p>
            <p className="vitara-tagline">All Your Health. In One Place.</p>
            <div className="vitara-rule" aria-hidden="true"><span>♥</span></div>
            <h1 className="vitara-promise"><span>Track.</span> <span>Understand.</span> <span>Thrive.</span></h1>
          </div>
        </div>
        <aside className="dashboard-trust-strip" aria-label="Data privacy and freshness">
          <div className="dashboard-trust-status">
            <span className="dashboard-trust-indicator" aria-hidden="true" />
            <div>
              <strong>Private on this device</strong>
              <span>Encrypted and offline by default</span>
            </div>
          </div>
          <dl className="dashboard-trust-facts">
            <div><dt>Active profile</dt><dd>{activeProfile?.displayName ?? profile?.displayName ?? "Local user"}</dd></div>
            <div><dt>Latest data</dt><dd>{latestObservedAt ? formatShortTimestamp(latestObservedAt) : "No readings yet"}</dd></div>
            <div><dt>Imports stored</dt><dd>{importCount}</dd></div>
          </dl>
        </aside>
      </section>

      <section className="dashboard-workspace">
        <article className="dashboard-profile">
          <div className="panel-heading-row">
            <h2>Profile context</h2>
            <div className="profile-toolbar">
              <button type="button" onClick={onEditProfile}>Edit</button>
              <button type="button" className="manage-profiles-button" onClick={onManageProfiles}>Manage</button>
            </div>
          </div>
          <dl className="profile-summary">
            <div><dt>Name</dt><dd>{profile?.displayName ?? "Local user"}</dd></div>
            <div><dt>Birth date</dt><dd>{profile?.birthDate ?? "Not set"}</dd></div>
            <div><dt>Profile type</dt><dd>{formatProfileSex(profile?.sex)} - {formatProfileType(profile?.subjectKind)}</dd></div>
            <div><dt>Blood type</dt><dd>{formatBloodType(profile?.bloodType)}</dd></div>
          </dl>
          <div className="profile-goals">
            <span>Current focus</span>
            <p>{profile?.goalSummary || "No focus set"}</p>
          </div>
        </article>

        <article className="dashboard-review">
          <div className="panel-heading-row">
            <div>
              <h2>Your latest data</h2>
              <p className="dashboard-section-copy">A quick review of what is stored for this profile.</p>
            </div>
            <button type="button" onClick={onNavigateSummary}>View summary</button>
          </div>
          <div className="dashboard-counts" aria-label="Stored health data totals">
            <Stat label="Observations" value={analytics?.counts.observations ?? 0} />
            <Stat label="Samples" value={analytics?.counts.samples ?? 0} />
            <Stat label="Activities" value={analytics?.counts.activities ?? 0} />
          </div>
          <div className="metric-list-scroll" aria-label="Latest metrics">
            <div className="metric-list">
              {analytics?.latestMetrics.length
                ? analytics.latestMetrics.map((metric) => (
                    <button
                      type="button"
                      className="metric metric-link"
                      key={metric.code}
                      onClick={() => onNavigateMeasurement(metric.code)}
                      aria-label={`View details for ${metric.label}, ${metric.value} ${metric.unit}, ${metric.status}`}
                    >
                      <span>{metric.label}</span>
                      <strong>{metric.value} {metric.unit}</strong>
                      <em data-status={metric.status}>{metric.status}</em>
                    </button>
                  ))
                : <p className="empty">Import data to populate latest metrics.</p>}
            </div>
          </div>
        </article>
      </section>

      <details className="dashboard-deeper-review">
        <summary>Explore trends, lab ranges, and AI review</summary>
        <div className="dashboard-deeper-grid">
          <section className="dashboard-deeper-section">
            <h2>Trend traces</h2>
            <div className="trend-grid">
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
            </div>
          </section>

          <section className="dashboard-deeper-section dashboard-lab-review">
            <h2>Lab range review</h2>
            {analytics?.labAlerts.length
              ? (
                  <div className="metric-list" aria-label="Lab range alerts">
                    {analytics.labAlerts.map((alert) => (
                      <button
                        type="button"
                        className="alert metric-link"
                        key={`${alert.code}-${alert.observedAt}`}
                        onClick={() => onNavigateMeasurement(alert.code)}
                        aria-label={`View details for ${alert.marker}, ${formatDetailValue(alert.value)} ${alert.unit}, ${formatShortTimestamp(alert.observedAt)}, ${alert.flag}${alert.reference ? `, reference ${alert.reference}` : ""}`}
                      >
                        <span>{alert.marker}</span>
                        <strong>{formatDetailValue(alert.value)} {alert.unit}</strong>
                        <em>{alert.flag}{alert.reference ? ` / ref ${alert.reference}` : ""}</em>
                      </button>
                    ))}
                  </div>
                )
              : <p className="empty">No out-of-range lab markers yet.</p>}
          </section>

          <section className="dashboard-deeper-section dashboard-ai-review">
            <h2>AI review</h2>
            <p className="safety">{safetyNotice}</p>
            <div className="dashboard-ai-actions">
              <button disabled={busy} onClick={onGenerateInsight}>Generate insights</button>
              <p className="dashboard-generated" aria-label={latestInsight?.createdAt ? `Last generated ${formatShortTimestamp(latestInsight.createdAt)}` : "Last generated not available"}>
                Last generated: {latestInsight?.createdAt ? formatShortTimestamp(latestInsight.createdAt) : "Not generated yet"}
              </p>
            </div>
            <InsightCard insight={latestInsight} />
          </section>
        </div>
      </details>
    </>
  );
}
