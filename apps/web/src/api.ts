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
  generateInsight: () => request<Insight>("/api/insights/generate", { method: "POST" })
};
