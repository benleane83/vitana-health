import type { PlannerOutcome, QueryDSL } from "./aiQueryPlanner.js";

export interface PlannerEvaluationCase {
  id: string;
  question: string;
  probe: boolean;
  expected: {
    supported: boolean;
    source?: NonNullable<QueryDSL["source"]>;
    intents?: QueryDSL["intent"][];
    metric?: string | null;
    groupBy?: QueryDSL["groupBy"];
    timePreset?: NonNullable<QueryDSL["timeRange"]["preset"]>;
  };
}

export const plannerEvaluationCases: PlannerEvaluationCase[] = [
  {
    id: "metric-average-heart-rate",
    question: "What was my average heart rate last month?",
    probe: true,
    expected: { supported: true, source: "metrics", intents: ["aggregation"], metric: "heart_rate", groupBy: null, timePreset: "last_month" }
  },
  {
    id: "metric-daily-steps",
    question: "Show my daily steps this month.",
    probe: true,
    expected: { supported: true, source: "metrics", intents: ["timeseries"], metric: "steps", groupBy: "day", timePreset: "this_month" }
  },
  {
    id: "activities-by-type",
    question: "Which exercises did I do this month?",
    probe: true,
    expected: { supported: true, source: "activities", intents: ["list_activities"], metric: null, timePreset: "this_month" }
  },
  {
    id: "health-events-immunizations",
    question: "List my immunizations from the last 90 days.",
    probe: true,
    expected: { supported: true, source: "health_events", intents: ["list"], metric: null, timePreset: "last_90d" }
  },
  {
    id: "care-items-by-priority",
    question: "Count open care items by priority.",
    probe: true,
    expected: { supported: true, source: "care_items", intents: ["count"], metric: null, groupBy: "priority" }
  },
  {
    id: "care-items-overdue",
    question: "What care items are overdue?",
    probe: true,
    expected: { supported: true, source: "care_items", intents: ["overdue"], metric: null }
  },
  {
    id: "unsupported-cross-source",
    question: "Compare my steps with completed immunizations by week.",
    probe: false,
    expected: { supported: false }
  },
  {
    id: "ambiguous-no-subject",
    question: "How am I doing?",
    probe: false,
    expected: { supported: false }
  }
];

export function evaluatePlannerCase(testCase: PlannerEvaluationCase, outcome: PlannerOutcome): string[] {
  if (!testCase.expected.supported) return outcome.ok ? ["Expected an unsupported outcome."] : [];
  if (!outcome.ok) return [`Planner failed with category ${outcome.category}.`];

  const issues: string[] = [];
  const source = outcome.dsl.source ?? (outcome.dsl.intent === "list_activities" ? "activities" : "metrics");
  if (testCase.expected.source && source !== testCase.expected.source) {
    issues.push(`Expected source ${testCase.expected.source}, got ${source}.`);
  }
  if (testCase.expected.intents && !testCase.expected.intents.includes(outcome.dsl.intent)) {
    issues.push(`Unexpected intent ${outcome.dsl.intent}.`);
  }
  if (testCase.expected.metric !== undefined && outcome.dsl.metric !== testCase.expected.metric) {
    issues.push(`Expected metric ${testCase.expected.metric}, got ${outcome.dsl.metric}.`);
  }
  if (testCase.expected.groupBy !== undefined && outcome.dsl.groupBy !== testCase.expected.groupBy) {
    issues.push(`Expected group ${testCase.expected.groupBy}, got ${outcome.dsl.groupBy}.`);
  }
  if (testCase.expected.timePreset && outcome.dsl.timeRange.preset !== testCase.expected.timePreset) {
    issues.push(`Expected time preset ${testCase.expected.timePreset}, got ${outcome.dsl.timeRange.preset ?? "custom"}.`);
  }
  return issues;
}
