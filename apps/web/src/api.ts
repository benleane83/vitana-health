import type {
  AnalyticsSummary,
  HealthDataSummary,
  HealthStoreData,
  Insight,
  ManualLabEntryPayload,
  Profile
} from "@local-fitness-advisor/shared";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...options?.headers
    }
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as T;
}

export interface AiQueryRow {
  [key: string]: unknown;
}

export interface AiQueryChartSeries {
  label: string;
  value: number;
}

export interface AiQueryChart {
  type: string;
  series: AiQueryChartSeries[];
}

export interface AiQueryResult {
  question: string;
  answer: string;
  limitations: string[];
  assumptions: string[];
  confidence: number;
  plan: unknown;
  sql: string | null;
  resolvedTimeRange?: { start: string; end: string; label: string };
  rowCount?: number;
  rows: AiQueryRow[];
  chart: AiQueryChart | null;
  model?: string;
  modelError?: string;
  suggestedRephrase?: string;
}

export const api = {
  health: () => request<{ ok: boolean; storage: string; counts: AnalyticsSummary["counts"] }>("/api/health"),
  store: () => request<HealthStoreData>("/api/store"),
  analytics: () => request<AnalyticsSummary>("/api/analytics"),
  summary: () => request<HealthDataSummary>("/api/summary"),
  saveProfile: (profile: Omit<Profile, "id" | "updatedAt">) =>
    request<Profile>("/api/profile", { method: "PUT", body: JSON.stringify(profile) }),
  importSamsung: (fileName: string, content: string) =>
    request<{ store: HealthStoreData }>("/api/import/samsung", { method: "POST", body: JSON.stringify({ fileName, content }) }),
  importBloodTest: (fileName: string, content: string) =>
    request<{ store: HealthStoreData }>("/api/import/blood-test", { method: "POST", body: JSON.stringify({ fileName, content }) }),
  importManualLabEntry: (payload: ManualLabEntryPayload) =>
    request<{ store: HealthStoreData }>("/api/import/labs/manual", { method: "POST", body: JSON.stringify(payload) }),
  generateInsight: () => request<Insight>("/api/insights/generate", { method: "POST" }),
  query: {
    ai: (question: string, options?: { timezone?: string; debug?: boolean }) =>
      request<AiQueryResult>("/api/query/ai", {
        method: "POST",
        body: JSON.stringify({ question, ...options })
      })
  }
};
