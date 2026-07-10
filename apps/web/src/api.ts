import type {
  AnalyticsSummary,
  BodyCompositionDraft,
  BodyCompositionDraftCommitPayload,
  DeleteObservationResponse,
  DeleteObservationsByTypeResponse,
  HealthDataDetail,
  HealthDataSummary,
  HealthStoreData,
  Insight,
  ManualLabEntryPayload,
  Profile,
  ProfileListEntry
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

export interface PendingPairing {
  id: string;
  deviceId: string;
  deviceName: string;
  requestedAt: string;
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

export interface ProfilesResponse {
  profiles: ProfileListEntry[];
  activeProfileId: string;
}

export const api = {
  health: () => request<{ ok: boolean; storage: string; counts: AnalyticsSummary["counts"] }>("/api/health"),
  store: () => request<HealthStoreData>("/api/store"),
  analytics: () => request<AnalyticsSummary>("/api/analytics"),
  summary: () => request<HealthDataSummary>("/api/summary"),
  healthDataDetail: (measurementCode: string) => request<HealthDataDetail>(`/api/summary/${encodeURIComponent(measurementCode)}`),
  deleteObservation: (id: string) => request<DeleteObservationResponse>(`/api/observations/${encodeURIComponent(id)}`, { method: "DELETE" }),
  deleteObservationsByType: (measurementCode: string) =>
    request<DeleteObservationsByTypeResponse>(`/api/observations/by-type/${encodeURIComponent(measurementCode)}`, { method: "DELETE" }),
  saveProfile: (profile: Omit<Profile, "id" | "updatedAt">) =>
    request<Profile>("/api/profile", { method: "PUT", body: JSON.stringify(profile) }),
  importBloodTest: (fileName: string, content: string) =>
    request<{ store: HealthStoreData }>("/api/import/blood-test", { method: "POST", body: JSON.stringify({ fileName, content }) }),
  previewBodyCompositionReport: (payload: { fileName: string; mimeType: string; contentBase64: string }) =>
    request<BodyCompositionDraft>("/api/import/body-composition/preview", { method: "POST", body: JSON.stringify(payload) }),
  commitBodyCompositionReport: (payload: BodyCompositionDraftCommitPayload) =>
    request<{ store: HealthStoreData }>("/api/import/body-composition/commit", { method: "POST", body: JSON.stringify(payload) }),
  importManualLabEntry: (payload: ManualLabEntryPayload) =>
    request<{ store: HealthStoreData }>("/api/import/labs/manual", { method: "POST", body: JSON.stringify(payload) }),
  generateInsight: () => request<Insight>("/api/insights/generate", { method: "POST" }),
  pairing: {
    pending: () => request<PendingPairing[]>("/api/pairing/pending"),
    approve: (id: string) => request<{ id: string; status: string }>(`/api/pairing/approve/${id}`, { method: "POST" }),
    deny: (id: string) => request<{ id: string; status: string }>(`/api/pairing/deny/${id}`, { method: "POST" })
  },
  profiles: {
    list: () => request<ProfilesResponse>("/api/profiles"),
    create: (displayName: string) =>
      request<ProfileListEntry>("/api/profiles", { method: "POST", body: JSON.stringify({ displayName }) }),
    active: () => request<{ profileId: string }>("/api/profiles/active"),
    setActive: (profileId: string) =>
      request<{ profileId: string }>("/api/profiles/active", { method: "PUT", body: JSON.stringify({ profileId }) }),
    remove: (profileId: string) => request<{ activeProfileId: string }>(`/api/profiles/${encodeURIComponent(profileId)}`, { method: "DELETE" })
  },
  query: {
    ai: (question: string, options?: { timezone?: string; debug?: boolean }) =>
      request<AiQueryResult>("/api/query/ai", {
        method: "POST",
        body: JSON.stringify({ question, ...options })
      })
  }
};
