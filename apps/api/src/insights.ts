import {
  buildInsightPrompt,
  safetyNotice,
  type AnalyticsSummary,
  type Insight,
  type Profile
} from "@vitana/shared";
import { callConfiguredModel } from "./modelClient.js";
import { hasCloudAiConsent, redactFreeText } from "./privacy.js";
import type { InsightReviewContext } from "./storage/profileRepository.js";

export interface InsightGenerationInput {
  profile: Profile;
  analytics: AnalyticsSummary;
  reviewContext?: InsightReviewContext;
}

const maxInsightEvidenceCharacters = 18_000;
const maxLatestMetrics = 40;

export async function generateInsight({ profile, analytics, reviewContext }: InsightGenerationInput): Promise<Insight> {
  const evidence = buildInsightEvidence(profile, analytics, reviewContext).map((item) => redactFreeText(item));

  const modelResult = await callConfiguredModel(buildInsightPrompt(evidence), {
    allowCloud: hasCloudAiConsent(profile)
  });
  if (modelResult.ok && modelResult.text) {
    return {
      id: id("insight"),
      createdAt: new Date().toISOString(),
      title: "Model-powered wellness review",
      body: modelResult.text,
      evidence,
      confidence: "medium",
      model: `${modelResult.provider}:${modelResult.model}`,
      safetyNotice
    };
  }

  const body = [
    "Local model runtime was not available, so this deterministic summary was generated instead.",
    analytics.labAlerts.length > 0
      ? `Review ${analytics.labAlerts.length} lab marker(s) outside supplied reference ranges and consider discussing them with a doctor.`
      : "No lab markers are currently outside supplied reference ranges.",
    analytics.trendCards.length > 0
      ? `Visible trends: ${analytics.trendCards.slice(0, 3).map((card) => `${card.label} ${card.direction}`).join(", ")}.`
      : "Add more dated measurements to unlock trend analysis.",
    "Recommendations: keep importing consistent data, verify units/reference ranges, and use this app to prepare better questions rather than self-diagnose."
  ].join("\n\n");

  return {
    id: id("insight"),
    createdAt: new Date().toISOString(),
    title: "Deterministic wellness review",
    body,
    evidence,
    confidence: "low",
    model: "deterministic",
    safetyNotice
  };
}

export function buildInsightEvidence(
  profile: Profile,
  analytics: AnalyticsSummary,
  reviewContext?: InsightReviewContext
): string[] {
  const [sourceSummary] = analytics.evidenceDigest;
  const latestMetrics = analytics.latestMetricsForInsight ?? analytics.latestMetrics;
  const alertCodes = new Set(analytics.labAlerts.map((alert) => alert.code));
  const trendCodes = new Set(analytics.trendCards.map((trend) => trend.code));
  const evidence: string[] = [subjectEvidence(profile)];

  if (reviewContext) {
    const { coverage } = reviewContext;
    evidence.push(coverage.latestDate
      ? `Recent data coverage: ${coverage.activeDays} active day(s) from ${coverage.earliestDate} to ${coverage.latestDate} in the last ${reviewContext.windowDays} days.`
      : `No daily measurement data is available in the last ${reviewContext.windowDays} days.`);
    evidence.push(...reviewContext.trackedMetrics.map((metric) =>
      `${boundedText(metric.label)}, last ${reviewContext.windowDays} days: average ${formatNumber(metric.average)} ${boundedText(metric.unit, 24)}, minimum ${formatNumber(metric.minimum)}, maximum ${formatNumber(metric.maximum)} across ${metric.days} day(s).`));
    if (reviewContext.activities.length > 0) {
      evidence.push(`Activities, last ${reviewContext.windowDays} days: ${reviewContext.activities.map((activity) =>
        `${boundedText(activity.type)} ${activity.sessions} session(s)${activity.durationMinutes === undefined ? "" : `/${formatNumber(activity.durationMinutes)} minutes`}`).join(", ")}.`);
    }
    if (reviewContext.healthEvents.length > 0) {
      evidence.push(`Completed health events, last 90 days: ${reviewContext.healthEvents.map((event) =>
        `${boundedText(event.kind)} ${event.count} (latest ${event.latestDate})`).join(", ")}.`);
    }
    evidence.push(`Care plan: ${reviewContext.care.open} open item(s), ${reviewContext.care.overdue} overdue, ${reviewContext.care.highPriority} high priority.`);
  }

  evidence.push(...analytics.labAlerts.map((alert) => {
      if (alert.flag === "unknown") {
        return `${boundedText(alert.marker)}: ${alert.value} ${boundedText(alert.unit, 24)} on ${alert.observedAt.slice(0, 10)}; a reference range exists but classification is unavailable${alert.reference ? ` (${boundedText(alert.reference, 40)})` : ""}.`;
      }
      return `${boundedText(alert.marker)}: ${alert.value} ${boundedText(alert.unit, 24)} on ${alert.observedAt.slice(0, 10)}, flagged ${alert.flag}${alert.reference ? ` against ${boundedText(alert.reference, 40)}` : ""}.`;
    }));

  evidence.push(...analytics.trendCards.flatMap((trend) => {
    const first = trend.points[0];
    const last = trend.points.at(-1)!;
    const change = last.value - first.value;
    if (formatNumber(change) === "0") return [];
    const percent = first.value === 0 ? undefined : change / Math.abs(first.value) * 100;
    return [`${boundedText(trend.label)} trend: ${formatNumber(first.value)} to ${formatNumber(last.value)} ${boundedText(trend.unit, 24)} from ${first.date} to ${last.date} across ${trend.points.length} readings (${change >= 0 ? "+" : ""}${formatNumber(change)}${percent === undefined ? "" : `, ${percent >= 0 ? "+" : ""}${formatNumber(percent)}%`}).`];
  }));

  const ordinaryMetrics = latestMetrics
    .filter((metric) => !alertCodes.has(metric.code) && !trendCodes.has(metric.code))
    .sort((left, right) => Number(right.isPinned) - Number(left.isPinned) || right.observedAt.localeCompare(left.observedAt))
    .slice(0, maxLatestMetrics);
  evidence.push(...ordinaryMetrics.map((metric) =>
    `${boundedText(metric.label)}: ${metric.value} ${boundedText(metric.unit, 24)} on ${metric.observedAt.slice(0, 10)}${metric.status === "unknown" ? "" : ` (${metric.status})`}.`));
  if (sourceSummary) evidence.push(sourceSummary);

  return withinEvidenceBudget(evidence);
}

function subjectEvidence(profile: Profile): string {
  const age = profile.birthDate ? ageInYears(profile.birthDate) : undefined;
  const ageText = age === undefined ? "age not supplied" : age < 2 ? "under 2 years" : age < 13 ? "child aged 2-12" : age < 18 ? "adolescent aged 13-17" : age < 40 ? "adult aged 18-39" : age < 65 ? "adult aged 40-64" : "adult aged 65 or older";
  if (profile.subjectKind === "pet") {
    return `Subject: pet (${boundedText(profile.pet?.species ?? "species not supplied")}${profile.pet?.breed ? `, ${boundedText(profile.pet.breed)}` : ""}); interpret results as veterinary wellness data.`;
  }
  return `Subject: ${profile.subjectKind === "child" ? "child profile" : "adult profile"}, ${ageText}${profile.sex && !["unknown", "not-specified"].includes(profile.sex) ? `, sex ${profile.sex}` : ""}.`;
}

function ageInYears(birthDate: string): number | undefined {
  const birth = new Date(`${birthDate}T00:00:00Z`);
  if (!Number.isFinite(birth.getTime())) return undefined;
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  if (now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age >= 0 ? age : undefined;
}

function formatNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function boundedText(value: string, maximumLength = 80): string {
  return value.replace(/[\r\n\t]+/g, " ").trim().slice(0, maximumLength);
}

function withinEvidenceBudget(evidence: string[]): string[] {
  const included: string[] = [];
  let characters = 0;
  for (const item of evidence) {
    if (characters + item.length > maxInsightEvidenceCharacters) break;
    included.push(item);
    characters += item.length;
  }
  return included;
}

function id(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
}

