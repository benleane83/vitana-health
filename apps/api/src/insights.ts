import {
  buildInsightPrompt,
  safetyNotice,
  type AnalyticsSummary,
  type Insight,
  type Profile
} from "@vitana/shared";
import { callConfiguredModel } from "./modelClient.js";
import { hasCloudAiConsent, redactFreeText } from "./privacy.js";

export interface InsightGenerationInput {
  profile: Profile;
  analytics: AnalyticsSummary;
}

const maxInsightMetrics = 100;

export async function generateInsight({ profile, analytics }: InsightGenerationInput): Promise<Insight> {
  const evidence = buildInsightEvidence(analytics);

  const modelResult = await callConfiguredModel(buildInsightPrompt(evidence.map((item) => redactFreeText(item))), {
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
      ? `Review ${analytics.labAlerts.length} lab marker(s) outside supplied reference ranges and consider discussing them with a clinician.`
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

export function buildInsightEvidence(analytics: AnalyticsSummary): string[] {
  const [sourceSummary, , labRangeSummary] = analytics.evidenceDigest;
  const latestMetrics = analytics.latestMetricsForInsight ?? analytics.latestMetrics;
  const includedMetrics = latestMetrics.slice(0, maxInsightMetrics);
  const omittedMetricCount = latestMetrics.length - includedMetrics.length;
  return [
    ...(sourceSummary ? [sourceSummary] : []),
    ...(labRangeSummary ? [labRangeSummary] : []),
    ...includedMetrics.map((metric) => `${metric.label}: ${metric.value} ${metric.unit} on ${metric.observedAt.slice(0, 10)}${metric.status === "unknown" ? "" : ` (${metric.status})`}.`),
    ...(omittedMetricCount > 0
      ? [`${omittedMetricCount} additional latest observation${omittedMetricCount === 1 ? " was" : "s were"} omitted to keep this review within its ${maxInsightMetrics}-reading limit.`]
      : []),
    ...analytics.labAlerts.map((alert) => {
      if (alert.flag === "unknown") {
        return `${alert.marker}: ${alert.value} ${alert.unit} on ${alert.observedAt}${alert.reference ? `, reference ${alert.reference}` : ""}.`;
      }
      return `${alert.marker}: ${alert.value} ${alert.unit} on ${alert.observedAt}, flagged ${alert.flag}${alert.reference ? ` against ${alert.reference}` : ""}.`;
    })
  ];
}

function id(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
}

