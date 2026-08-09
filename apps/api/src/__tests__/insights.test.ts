import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsSummary, Profile } from "@vitana/shared";

const callConfiguredModel = vi.hoisted(() => vi.fn());

vi.mock("../modelClient.js", () => ({ callConfiguredModel }));

import { buildInsightEvidence, generateInsight } from "../insights.js";

const profile: Profile = {
  id: "self",
  displayName: "Test profile",
  setupStatus: "complete",
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
      { code: "hba1c", label: "HbA1c", value: 5.7, unit: "%", observedAt: "2026-07-23T00:00:00.000Z", status: "unknown", isPinned: false },
      { code: "heart_rate", label: "Heart rate", value: 72, unit: "bpm", observedAt: "2026-07-22T00:00:00.000Z", status: "normal", isPinned: false }
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

  it("omits unknown status labels without omitting the reading", async () => {
    const insight = await generateInsight({ profile, analytics: analytics() });

    const prompt = callConfiguredModel.mock.calls[0]?.[0] as string;
    expect(prompt).toContain("HbA1c: 5.7 % on 2026-07-23.");
    expect(prompt).not.toContain("HbA1c: 5.7 % on 2026-07-23 (unknown).");
    expect(prompt).not.toContain("no applicable reference range");
    expect(prompt).toContain("Heart rate: 72 bpm on 2026-07-22 (normal).");
    expect(prompt).not.toContain("Latest tracked metric is HbA1c");
    expect(insight.evidence).toContain("HbA1c: 5.7 % on 2026-07-23.");
  });

  it("bounds ordinary latest metrics after higher-value evidence", () => {
    const latestMetricsForInsight = Array.from({ length: 101 }, (_, index) => ({
      code: `metric_${index + 1}`,
      label: `Metric ${index + 1}`,
      value: index + 1,
      unit: "units",
      observedAt: "2026-07-23T00:00:00.000Z",
      status: "normal" as const,
      isPinned: false
    }));

    const evidence = buildInsightEvidence(profile, { ...analytics(), latestMetricsForInsight });
    expect(evidence.filter((item) => item.startsWith("Metric "))).toHaveLength(40);
    expect(evidence).toContain("Metric 1: 1 units on 2026-07-23 (normal).");
    expect(evidence).not.toContain("Metric 41: 41 units on 2026-07-23 (normal).");
  });

  it("keeps an unclassified lab alert without calling it an unknown flag", () => {
    const evidence = buildInsightEvidence(profile, {
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

    expect(evidence).toContain("HbA1c: 31.1 mmol/mol on 2026-07-23; a reference range exists but classification is unavailable (--41).");
    expect(evidence).not.toContain(expect.stringContaining("flagged unknown"));
  });

  it("frames the subject and includes bounded structured health context", () => {
    const evidence = buildInsightEvidence({
      ...profile,
      subjectKind: "child",
      birthDate: "2016-01-01",
      sex: "female"
    }, analytics(), {
      windowDays: 30,
      coverage: { earliestDate: "2026-07-10", latestDate: "2026-08-08", activeDays: 24 },
      trackedMetrics: [{
        code: "steps",
        label: "Steps",
        unit: "count",
        average: 8123.456,
        minimum: 2100,
        maximum: 14002,
        days: 24
      }],
      activities: [{ type: "walking", sessions: 12, durationMinutes: 420 }],
      healthEvents: [{ kind: "visit", count: 2, latestDate: "2026-08-01" }],
      care: { open: 3, overdue: 1, highPriority: 1 }
    });

    expect(evidence[0]).toContain("child profile");
    expect(evidence[0]).toContain("sex female");
    expect(evidence).toContain("Recent data coverage: 24 active day(s) from 2026-07-10 to 2026-08-08 in the last 30 days.");
    expect(evidence).toContain("Steps, last 30 days: average 8123.46 count, minimum 2100, maximum 14002 across 24 day(s).");
    expect(evidence).toContain("Activities, last 30 days: walking 12 session(s)/420 minutes.");
    expect(evidence).toContain("Completed health events, last 90 days: visit 2 (latest 2026-08-01).");
    expect(evidence).toContain("Care plan: 3 open item(s), 1 overdue, 1 high priority.");
  });

  it("does not repeat metrics already represented by an alert or trend", () => {
    const evidence = buildInsightEvidence(profile, {
      ...analytics(),
      latestMetricsForInsight: [
        ...analytics().latestMetrics,
        { code: "weight", label: "Weight", value: 80, unit: "kg", observedAt: "2026-07-23T00:00:00.000Z", status: "normal", isPinned: false }
      ],
      labAlerts: [{
        code: "hba1c", marker: "HbA1c", value: 5.7, unit: "%", observedAt: "2026-07-23T00:00:00.000Z",
        reference: "4-5.6", flag: "high"
      }],
      trendCards: [{
        code: "weight", label: "Weight", unit: "kg", direction: "down", summary: "Weight is down.",
        points: [{ date: "2026-07-01", value: 82 }, { date: "2026-07-23", value: 80 }]
      }]
    });

    expect(evidence.filter((item) => item.startsWith("HbA1c:"))).toHaveLength(1);
    expect(evidence.filter((item) => item.startsWith("Weight"))).toHaveLength(1);
    expect(evidence).toContain("Weight trend: 82 to 80 kg from 2026-07-01 to 2026-07-23 across 2 readings (-2, -2.44%).");
  });

  it("persists the same redacted evidence sent to the model", async () => {
    const insight = await generateInsight({
      profile: {
        ...profile,
        subjectKind: "pet",
        pet: { species: "test@example.com" }
      },
      analytics: analytics(),
      reviewContext: {
        windowDays: 30,
        coverage: { activeDays: 24 },
        trackedMetrics: [{
          code: "steps", label: "Steps", unit: "count", average: 8123, minimum: 2100, maximum: 14002, days: 24
        }],
        activities: [],
        healthEvents: [],
        care: { open: 0, overdue: 0, highPriority: 0 }
      }
    });

    const prompt = callConfiguredModel.mock.calls[0]?.[0] as string;
    expect(prompt).toContain("[redacted-email]");
    expect(insight.evidence.some((item) => item.includes("[redacted-email]"))).toBe(true);
    expect(prompt).toContain(insight.evidence[0]);
    expect(prompt).toContain("minimum 2100, maximum 14002");
    expect(JSON.stringify(insight.evidence)).not.toContain("test@example.com");
  });
});