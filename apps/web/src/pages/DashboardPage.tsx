import { careItemKindLabels } from "@vitana/shared";
import type { AnalyticsSummary, CareItem, HealthDataSummary, Profile } from "@vitana/shared";
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, Pin } from "lucide-react";
import { MiniChart } from "../components/Charts.js";
import { formatBloodType, formatDetailValue, formatProfileSex, formatProfileType, formatShortTimestamp } from "../utils.js";
import { profileDataCategories, type ProfileDataCategory } from "../types.js";

const categoryIconPaths: Record<ProfileDataCategory, string> = {
  activity: "/images/profile-navigation/activity.png",
  body: "/images/profile-navigation/body-composition.png",
  lab: "/images/profile-navigation/lab-results.png",
  sleep: "/images/profile-navigation/sleep.png"
};

export function DashboardPage({
  analytics,
  summary,
  summaryError,
  profile,
  upcomingCare,
  onEditProfile,
  onNavigateSummary,
  onNavigateMeasurement,
  onNavigateCategory,
  onNavigateCare,
  onRetryUpcomingCare
}: {
  analytics?: AnalyticsSummary;
  summary?: HealthDataSummary;
  summaryError?: string;
  profile?: Profile;
  upcomingCare: { items: CareItem[]; total: number; busy: boolean; error?: string };
  onEditProfile: () => void;
  onNavigateSummary: () => void;
  onNavigateMeasurement: (measurementCode: string) => void;
  onNavigateCategory: (category: ProfileDataCategory) => void;
  onNavigateCare: (careItemId?: string) => void;
  onRetryUpcomingCare: () => void;
}) {
  const latestObservedAt = analytics?.latestMetrics
    .map((metric) => metric.observedAt)
    .sort((left, right) => right.localeCompare(left))[0];

  return (
    <>
      <section className="dashboard-workspace">
        <article className="dashboard-profile">
          <div className="panel-heading-row">
            <h2>Profile context</h2>
            <div className="profile-toolbar">
              <button className="profile-edit-button" type="button" onClick={onEditProfile}>Edit</button>
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

        <article className="dashboard-profile-summary">
          <h2>Profile summary</h2>
          {summaryError ? <p className="dashboard-summary-error" role="alert">Profile summary could not be loaded.</p> : null}
          <div className="dashboard-counts" aria-label="Stored health data totals">
            {profileDataCategories.map((category) => {
              const iconPath = categoryIconPaths[category.key];
              const count = summary?.categories.find((item) => item.key === category.key)?.counts.total ?? 0;
              return (
                <button
                  className={`dashboard-category-count dashboard-category-count--${category.key}`}
                  type="button"
                  key={category.key}
                  onClick={() => onNavigateCategory(category.key)}
                  aria-label={`View ${category.label}: ${count} entries in Track`}
                >
                  <span className="dashboard-category-count__icon" aria-hidden="true">
                    <img src={iconPath} alt="" />
                  </span>
                  <span className="dashboard-category-count__label">{category.label}</span>
                  <strong>{count}</strong>
                  <ChevronRight aria-hidden="true" size={18} />
                </button>
              );
            })}
          </div>
        </article>

        <article className="dashboard-review">
          <div className="panel-heading-row">
            <div className="dashboard-review-heading">
              <div className="dashboard-review-title">
                <h2>Your latest data</h2>
                <span className="dashboard-latest-reading">
                  Latest reading: {latestObservedAt ? formatShortTimestamp(latestObservedAt) : "No readings yet"}
                </span>
              </div>
              <p className="dashboard-section-copy">A quick review of what is stored for this profile.</p>
            </div>
            <button type="button" onClick={onNavigateSummary}>View all</button>
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
                      aria-label={`View details for ${metric.label}, ${formatDetailValue(metric.value)} ${metric.unit}, ${metric.status}${metric.isPinned ? ", pinned" : ""}`}
                    >
                      <span className="metric-label">
                        {metric.label}
                        {metric.isPinned ? (
                          <span className="metric-pin-marker" title="Pinned">
                            <Pin aria-hidden="true" fill="currentColor" size={14} />
                          </span>
                        ) : null}
                      </span>
                      <strong>{formatDetailValue(metric.value)} {metric.unit}</strong>
                      <em data-status={metric.status}>{metric.status}</em>
                    </button>
                  ))
                : <p className="empty">Import data to populate latest metrics.</p>}
            </div>
          </div>
        </article>
      </section>

      <section className={`dashboard-upcoming-care${upcomingCare.items.some(isOverdue) ? " has-overdue" : ""}`} aria-labelledby="upcoming-care-heading">
        <div className="dashboard-upcoming-care-heading">
          <div>
            <h2 id="upcoming-care-heading">Upcoming care</h2>
            <p>{upcomingCare.total > 0 ? formatCareSummary(upcomingCare.total) : "A 30-day view of care that needs attention."}</p>
          </div>
          {!upcomingCare.busy && !upcomingCare.error && upcomingCare.total > 0 ? (
            <button className="dashboard-care-view-all" type="button" onClick={() => onNavigateCare()}>
              View all <ChevronRight aria-hidden="true" size={17} />
            </button>
          ) : null}
        </div>

        {upcomingCare.busy ? (
          <div className="dashboard-care-loading" role="status" aria-label="Loading upcoming care">
            {[0, 1, 2].map((index) => <span key={index} aria-hidden="true" />)}
          </div>
        ) : upcomingCare.error ? (
          <div className="dashboard-care-state dashboard-care-error" role="alert">
            <AlertTriangle aria-hidden="true" size={19} />
            <span>Upcoming care could not be loaded.</span>
            <button type="button" onClick={onRetryUpcomingCare}>Try again</button>
          </div>
        ) : upcomingCare.items.length ? (
          <div className="dashboard-care-items">
            {upcomingCare.items.map((item) => {
              const dueText = formatRelativeDueDate(item.dueStart);
              const overdue = isOverdue(item);
              return (
                <button
                  className="dashboard-care-item"
                  data-overdue={overdue || undefined}
                  type="button"
                  key={item.id}
                  onClick={() => onNavigateCare(item.id)}
                  aria-label={`${item.title}, ${careItemKindLabels[item.kind]}, ${dueText}. Open in Care.`}
                >
                  <span className="dashboard-care-item-icon" aria-hidden="true">
                    {overdue ? <AlertTriangle size={18} /> : <CalendarClock size={18} />}
                  </span>
                  <span className="dashboard-care-item-copy">
                    <strong>{item.title}</strong>
                    <span>{careItemKindLabels[item.kind]}</span>
                  </span>
                  <span className="dashboard-care-due">{dueText}</span>
                  <ChevronRight className="dashboard-care-item-arrow" aria-hidden="true" size={18} />
                </button>
              );
            })}
          </div>
        ) : (
          <div className="dashboard-care-state dashboard-care-clear" role="status">
            <CheckCircle2 aria-hidden="true" size={19} />
            <span>Nothing due in the next 30 days.</span>
          </div>
        )}
      </section>

      <details className="dashboard-deeper-review" open>
        <summary>Explore trends and lab ranges</summary>
        <div className="dashboard-deeper-grid">
          <section className="dashboard-deeper-section">
            <h2>Trend traces</h2>
            <div className="trend-grid">
              {analytics?.trendCards.length
                ? analytics.trendCards.map((card) => (
                    <button
                      type="button"
                      className="trend trend-link"
                      key={card.code}
                      onClick={() => onNavigateMeasurement(card.code)}
                      aria-label={`View details for ${card.label} trend`}
                    >
                      <div>
                        <strong>{card.label}</strong>
                        <span>{formatTrendSummary(card.label, card.summary)}</span>
                      </div>
                      <MiniChart label={card.label} points={card.points} />
                    </button>
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
                        <em>{alert.flag}{alert.reference ? ` / ref ${formatReferenceNumber(alert.reference)}` : ""}</em>
                      </button>
                    ))}
                  </div>
                )
              : <p className="empty">No out-of-range lab markers yet.</p>}
          </section>

        </div>
      </details>
    </>
  );
}

function formatCareSummary(total: number): string {
  return `${total} ${total === 1 ? "item needs" : "items need"} attention in the next 30 days.`;
}

function formatTrendSummary(label: string, summary: string): string {
  const labelPrefix = `${label} `;
  return summary.startsWith(labelPrefix) ? summary.slice(labelPrefix.length) : summary;
}

function formatReferenceNumber(reference: string): string {
  return reference.replace(/^-+/, "");
}

function isOverdue(item: CareItem): boolean {
  if (!item.dueStart) return false;
  return daysFromToday(item.dueStart) < 0;
}

function formatRelativeDueDate(value?: string): string {
  if (!value) return "Due date unavailable";
  const days = daysFromToday(value);
  if (days < 0) return `Overdue by ${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"}`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
}

function daysFromToday(value: string): number {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 0;
  const now = new Date();
  const dueDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((dueDay - today) / 86_400_000);
}
