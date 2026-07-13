import type {
  AnalyticsSummary,
  BiologicalAgeReport,
  BodyCompositionDraft,
  BodyCompositionDraftCommitPayload,
  CloudAiConsent,
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

const ownerTokenKey = "local-fitness-advisor.ownerToken";
let ownerTokenPromptInFlight: Promise<string | null> | undefined;

function ownerHeaders(options?: RequestInit): HeadersInit {
  const token = window.sessionStorage.getItem(ownerTokenKey);
  return {
    "content-type": "application/json",
    ...(token ? { authorization: "Bearer " + token } : {}),
    ...options?.headers
  };
}

async function fetchAsOwner(path: string, options?: RequestInit, retry = true): Promise<Response> {
  const response = await fetch(path, {
    ...options,
    credentials: "include",
    headers: ownerHeaders(options)
  });
  if (response.status === 401 && retry) {
    const authenticated = await fetch("/api/auth/local", {
      method: "POST",
      credentials: "include",
      headers: { accept: "application/json" }
    });
    if (authenticated.ok) {
      return fetchAsOwner(path, options, false);
    }
    const token = await promptForOwnerToken();
    if (token) {
      window.sessionStorage.setItem(ownerTokenKey, token);
      return fetchAsOwner(path, options, false);
    }
  }
  return response;
}

async function promptForOwnerToken(): Promise<string | null> {
  if (!ownerTokenPromptInFlight) {
    ownerTokenPromptInFlight = Promise.resolve(
      window.prompt("Enter the Local Fitness Advisor owner token shown by the API at startup:")
    ).finally(() => {
      ownerTokenPromptInFlight = undefined;
    });
  }
  return ownerTokenPromptInFlight;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetchAsOwner(path, options);
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

export interface PairedDevice {
  id: string;
  deviceId: string;
  deviceName: string;
  requestedAt: string;
  resolvedAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
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

export interface LlmConfig {
  provider: "ollama" | "openai";
  endpoint: string;
  model: string;
  timeoutMs: number;
}

export interface AiSettings extends LlmConfig {
  hasApiKey: boolean;
}

export interface ModelValidation {
  ok: boolean;
  provider: "ollama" | "openai";
  endpoint: string;
  model: string;
  timeoutMs: number;
  elapsedMs: number;
  text?: string;
  status?: number;
  error?: string;
  bodySnippet?: string;
}

export interface ProfilesResponse {
  profiles: ProfileListEntry[];
  activeProfileId: string;
}

export const api = {
  health: () => request<{ ok: boolean; storage: string; counts: AnalyticsSummary["counts"] }>("/api/health"),
  store: () => request<HealthStoreData>("/api/store"),
  analytics: () => request<AnalyticsSummary>("/api/analytics"),
  biologicalAge: () => request<BiologicalAgeReport>("/api/biological-age"),
  exportPdf: async () => {
    const response = await fetchAsOwner("/api/export/pdf", { headers: { accept: "application/pdf" } });
    if (!response.ok) throw new Error(await response.text());
    return {
      blob: await response.blob(),
      filename: response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "health-report.pdf"
    };
  },
  summary: () => request<HealthDataSummary>("/api/summary"),
  healthDataDetail: (measurementCode: string, page?: { limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (page?.limit !== undefined) query.set("limit", String(page.limit));
    if (page?.offset !== undefined) query.set("offset", String(page.offset));
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return request<HealthDataDetail>(`/api/summary/${encodeURIComponent(measurementCode)}${suffix}`);
  },
  deleteObservation: (id: string) => request<DeleteObservationResponse>(`/api/observations/${encodeURIComponent(id)}`, { method: "DELETE" }),
  deleteObservationsByType: (measurementCode: string) =>
    request<DeleteObservationsByTypeResponse>(`/api/observations/by-type/${encodeURIComponent(measurementCode)}`, { method: "DELETE" }),
  saveProfile: (profile: Omit<Profile, "id" | "updatedAt">) =>
    request<Profile>("/api/profile", { method: "PUT", body: JSON.stringify(profile) }),
  cloudAiConsent: {
    get: () => request<CloudAiConsent>("/api/profile/cloud-ai-consent"),
    set: (payload: { enabled: boolean; providerScopeAccepted: boolean; consentVersion?: string }) =>
      request<CloudAiConsent>("/api/profile/cloud-ai-consent", { method: "PUT", body: JSON.stringify(payload) })
  },
  importBloodTest: (fileName: string, content: string) =>
    request<{ store: HealthStoreData }>("/api/import/blood-test", { method: "POST", body: JSON.stringify({ fileName, content }) }),
  importObservationCsv: (fileName: string, content: string) =>
    request<{ store: HealthStoreData }>("/api/import/observations/csv", { method: "POST", body: JSON.stringify({ fileName, content }) }),
  previewBodyCompositionReport: (payload: { fileName: string; mimeType: string; contentBase64: string }) =>
    request<BodyCompositionDraft>("/api/import/body-composition/preview", { method: "POST", body: JSON.stringify(payload) }),
  commitBodyCompositionReport: (payload: BodyCompositionDraftCommitPayload) =>
    request<{ store: HealthStoreData }>("/api/import/body-composition/commit", { method: "POST", body: JSON.stringify(payload) }),
  previewBloodTestReport: (payload: { fileName: string; mimeType: string; contentBase64: string }) =>
    request<BodyCompositionDraft>("/api/import/blood-test/preview", { method: "POST", body: JSON.stringify(payload) }),
  commitBloodTestReport: (payload: BodyCompositionDraftCommitPayload) =>
    request<{ store: HealthStoreData }>("/api/import/blood-test/commit", { method: "POST", body: JSON.stringify(payload) }),
  importManualLabEntry: (payload: ManualLabEntryPayload) =>
    request<{ store: HealthStoreData }>("/api/import/labs/manual", { method: "POST", body: JSON.stringify(payload) }),
  importManualObservations: (payload: { observedAt: string; label: string; sourceName?: string; observations: Array<{ measurementName?: string; measurementCode?: string; value: number; unit?: string }> }) =>
    request<{ store: HealthStoreData }>("/api/import/observations/manual", { method: "POST", body: JSON.stringify(payload) }),
  generateInsight: () => request<Insight>("/api/insights/generate", { method: "POST" }),
  pairing: {
    qr: async () => {
      const response = await fetchAsOwner("/api/pair/qr");
      if (!response.ok) throw new Error(await response.text());
      return response.blob();
    },
    pending: () => request<PendingPairing[]>("/api/pairing/pending"),
    devices: () => request<PairedDevice[]>("/api/pairing/devices"),
    approve: (id: string) => request<{ id: string; status: string }>(`/api/pairing/approve/${id}`, { method: "POST" }),
    deny: (id: string) => request<{ id: string; status: string }>(`/api/pairing/deny/${id}`, { method: "POST" }),
    revoke: (id: string) => request<PairedDevice>(`/api/pairing/revoke/${id}`, { method: "POST" })
  },
  profiles: {
    list: () => request<ProfilesResponse>("/api/profiles"),
    create: (displayName: string) =>
      request<ProfileListEntry>("/api/profiles", { method: "POST", body: JSON.stringify({ displayName }) }),
    active: () => request<{ profileId: string }>("/api/profiles/active"),
    setActive: (profileId: string) =>
      request<{ profileId: string }>("/api/profiles/active", { method: "PUT", body: JSON.stringify({ profileId }) }),
    remove: (profileId: string) =>
      request<{ activeProfileId: string; profiles: ProfileListEntry[] }>(`/api/profiles/${encodeURIComponent(profileId)}`, { method: "DELETE" })
  },
  query: {
    ai: (question: string, options?: { timezone?: string; debug?: boolean }) =>
      request<AiQueryResult>("/api/query/ai", {
        method: "POST",
        body: JSON.stringify({ question, ...options })
      })
  },
  llm: {
    config: () => request<LlmConfig>("/api/llm/config")
  }
};
