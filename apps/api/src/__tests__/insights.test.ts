import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsSummary, Profile } from "@vitana/shared";

const callConfiguredModel = vi.hoisted(() => vi.fn());

vi.mock("../modelClient.js", () => ({ callConfiguredModel }));

import { buildInsightEvidence, generateInsight } from "../insights.js";

const profile: Profile = {
  id: "self",
  displayName: "Test profile",
  units: "metric",
  updatedAt: "2026-07-23T00:00:00.000Z"
};

function analytics(): AnalyticsSummary {
  return {
    counts: { imports: 1, observations: 2, samples: 0, activities: 0, insights: 0, healthEvents: 0, careItems: 0 },
    evidenceDigest: [
      "Imported 1 source file(s), 2 observations, and 0 tracker samples.",
      "Latest tracked metric is HbA1c: 5.7 %.",
      "No lab markers are outside supplied reference ranges."
    ],
    latestMetrics: [
      { code: "hba1c", label: "HbA1c", value: 5.7, unit: "%", observedAt: "2026-07-23T00:00:00.000Z", status: "unknown" },
      { code: "heart_rate", label: "Heart rate", value: 72, unit: "bpm", observedAt: "2026-07-22T00:00:00.000Z", status: "normal" }
    ],
    trendCards: [],
    labAlerts: []
  };
}

describe("generateInsight", () => {
  beforeEach(() => {
    callConfiguredModel.mockReset();
    callConfiguredModel.mockResolvedValue({ ok: true, text: "Review complete.", provider: "ollama", model: "test-model" });
  });

  it("omits an unknown status label without omitting the reading from the model prompt", async () => {
    const insight = await generateInsight({ profile, analytics: analytics() });

    const prompt = callConfiguredModel.mock.calls[0]?.[0] as string;
    expect(prompt).toContain("HbA1c: 5.7 % on 2026-07-23.");
    expect(prompt).not.toContain("HbA1c: 5.7 % on 2026-07-23 (unknown).");
    expect(prompt).toContain("Heart rate: 72 bpm on 2026-07-22 (normal).");
    expect(prompt).not.toContain("Latest tracked metric is HbA1c");
    expect(insight.evidence).toContain("HbA1c: 5.7 % on 2026-07-23.");
  });

  it("uses all latest observation metrics up to the evidence limit", () => {
    const latestMetricsForInsight = Array.from({ length: 101 }, (_, index) => ({
      code: `metric_${index + 1}`,
      label: `Metric ${index + 1}`,
      value: index + 1,
      unit: "units",
      observedAt: "2026-07-23T00:00:00.000Z",
      status: "normal" as const
    }));

    const evidence = buildInsightEvidence({ ...analytics(), latestMetricsForInsight });
    expect(evidence).toHaveLength(103);
    expect(evidence).toContain("Metric 100: 100 units on 2026-07-23 (normal).");
    expect(evidence).not.toContain("Metric 101: 101 units on 2026-07-23 (normal).");
    expect(evidence).toContain("1 additional latest observation was omitted to keep this review within its 100-reading limit.");
  });

  it("keeps an unknown lab reading while omitting its unknown flag", () => {
    const evidence = buildInsightEvidence({
      ...analytics(),
      labAlerts: [{
        code: "hba1c",
        marker: "HbA1c",
        value: 31.1,
        unit: "mmol/mol",
        observedAt: "2026-07-23T00:00:00.000Z",
        reference: "--41",
        flag: "unknown"
      }]
    });

    expect(evidence).toContain("HbA1c: 31.1 mmol/mol on 2026-07-23T00:00:00.000Z, reference --41.");
    expect(evidence).not.toContain(expect.stringContaining("flagged unknown"));
  });
});