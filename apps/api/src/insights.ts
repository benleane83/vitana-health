import { buildInsightPrompt, computeAnalytics, safetyNotice, type HealthStoreData, type Insight } from "@local-fitness-advisor/shared";
import { callConfiguredModel } from "./modelClient.js";
import { hasCloudAiConsent, redactFreeText } from "./privacy.js";

export async function generateInsight(store: HealthStoreData): Promise<Insight> {
  const analytics = computeAnalytics(store);
  const evidence = [
    ...analytics.evidenceDigest,
    ...analytics.latestMetrics.slice(0, 6).map((metric) => `${metric.label}: ${metric.value} ${metric.unit} on ${metric.observedAt.slice(0, 10)} (${metric.status}).`),
    ...analytics.labAlerts.map((alert) => `${alert.marker}: ${alert.value} ${alert.unit}, flagged ${alert.flag}${alert.reference ? ` against ${alert.reference}` : ""}.`)
  ];

  const modelResult = await callConfiguredModel(buildInsightPrompt(evidence.map((item) => redactFreeText(item))), {
    allowCloud: hasCloudAiConsent(store.profile)
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

function id(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
}

