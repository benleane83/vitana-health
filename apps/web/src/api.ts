import type {
  BodyCompositionDraftCommitPayload,
  BackupCreateRequest,
  BackupInspectResponse,
  BackupRestoreResponse,
  DeleteObservationResponse,
  DeleteObservationsByTypeResponse,
  ManualLabEntryPayload,
  Profile,
  ProfileListEntry,
  RestoreDecision,
  UpdateObservationInput,
  UpdateObservationResponse,
  AiQueryResponse as SharedAiQueryResponse,
  AiSettingsResponse as SharedAiSettingsResponse,
  ImportMutationResponse as SharedImportMutationResponse,
  LlmConfigResponse as SharedLlmConfigResponse,
  ModelValidationResponse as SharedModelValidationResponse,
  PairedDevice as SharedPairedDevice,
  PendingPairing as SharedPendingPairing,
  ProfilesResponse as SharedProfilesResponse
} from "@local-fitness-advisor/shared";
import {
  aiQueryResponseSchema,
  aiSettingsResponseSchema,
  analyticsSummaryResponseSchema,
  apiErrorResponseSchema,
  appBootstrapResponseSchema,
  backupInspectResponseSchema,
  backupRestoreResponseSchema,
  biologicalAgeResponseSchema,
  bodyCompositionDraftResponseSchema,
  cloudAiConsentResponseSchema,
  deleteObservationResponseSchema,
  deleteObservationsByTypeResponseSchema,
  healthDataDetailResponseSchema,
  healthDataSummaryResponseSchema,
  healthResponseSchema,
  importMutationResponseSchema,
  insightResponseSchema,
  llmConfigResponseSchema,
  modelValidationResponseSchema,
  pairedDeviceSchema,
  pairedDevicesResponseSchema,
  pairingMutationResponseSchema,
  pendingPairingsResponseSchema,
  profileDeleteResponseSchema,
  profileIdResponseSchema,
  profileListEntrySchema,
  profileResponseSchema,
  profilesResponseSchema,
  updateObservationResponseSchema
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

interface ResponseSchema<T> {
  parse(value: unknown): T;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly correlationId?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  const text = await response.text();
  const headerCorrelationId = response.headers.get("x-correlation-id") ?? undefined;
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = undefined;
  }
  const parsed = apiErrorResponseSchema.safeParse(payload);
  return new ApiError(
    parsed.success ? parsed.data.error : text || response.statusText || "API request failed.",
    response.status,
    parsed.success ? parsed.data.code : "HTTP_ERROR",
    parsed.success ? parsed.data.correlationId ?? headerCorrelationId : headerCorrelationId
  );
}

async function assertResponseOk(response: Response): Promise<void> {
  if (!response.ok) throw await apiErrorFromResponse(response);
}

async function request<T>(schema: ResponseSchema<T>, path: string, options?: RequestInit): Promise<T> {
  const response = await fetchAsOwner(path, options);
  await assertResponseOk(response);
  return schema.parse(await response.json());
}

export type AiQueryResult = SharedAiQueryResponse;
export type AiQueryRow = SharedAiQueryResponse["rows"][number];
export type AiQueryChart = NonNullable<SharedAiQueryResponse["chart"]>;
export type AiQueryChartSeries = AiQueryChart["series"][number];
export type PendingPairing = SharedPendingPairing;
export type PairedDevice = SharedPairedDevice;
export type LlmConfig = SharedLlmConfigResponse;
export type AiSettings = SharedAiSettingsResponse;
export type ModelValidation = SharedModelValidationResponse;
export type ProfilesResponse = SharedProfilesResponse;
export type ImportMutationResponse = SharedImportMutationResponse;

export type DeleteObservationMutationResponse = DeleteObservationResponse;
export type DeleteObservationsByTypeMutationResponse = DeleteObservationsByTypeResponse;
export type UpdateObservationMutationResponse = UpdateObservationResponse;

export const api = {
  health: () => request(healthResponseSchema, "/api/health"),
  bootstrap: () => request(appBootstrapResponseSchema, "/api/bootstrap"),
  analytics: () => request(analyticsSummaryResponseSchema, "/api/analytics"),
  biologicalAge: () => request(biologicalAgeResponseSchema, "/api/biological-age"),
  exportPdf: async () => {
    const response = await fetchAsOwner("/api/export/pdf", { headers: { accept: "application/pdf" } });
    await assertResponseOk(response);
    return {
      blob: await response.blob(),
      filename: response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "health-report.pdf"
    };
  },
  backups: {
    create: async (payload: BackupCreateRequest) => {
      const response = await fetchAsOwner("/api/backups/create", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      await assertResponseOk(response);
      return {
        blob: await response.blob(),
        filename: response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "backup.lfa-backup"
      };
    },
    inspect: (file: Blob, passphrase: string): Promise<BackupInspectResponse> =>
      request(backupInspectResponseSchema, "/api/backups/inspect", {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "x-backup-passphrase": passphrase
        },
        body: file
      }),
    restore: (file: Blob, passphrase: string, decisions: Array<{
      profileId: string;
      decision: RestoreDecision;
      acknowledgeReplacement?: string;
    }>): Promise<BackupRestoreResponse> =>
      request(backupRestoreResponseSchema, "/api/backups/restore", {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "x-backup-passphrase": passphrase,
          "x-restore-decisions": JSON.stringify(decisions)
        },
        body: file
      })
  },
  summary: () => request(healthDataSummaryResponseSchema, "/api/summary"),
  healthDataDetail: (measurementCode: string, page?: { limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (page?.limit !== undefined) query.set("limit", String(page.limit));
    if (page?.offset !== undefined) query.set("offset", String(page.offset));
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return request(healthDataDetailResponseSchema, `/api/summary/${encodeURIComponent(measurementCode)}${suffix}`);
  },
  updateObservation: (id: string, input: UpdateObservationInput) =>
    request(updateObservationResponseSchema, `/api/observations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  deleteObservation: (id: string) => request(deleteObservationResponseSchema, `/api/observations/${encodeURIComponent(id)}`, { method: "DELETE" }),
  deleteObservationsByType: (measurementCode: string) =>
    request(deleteObservationsByTypeResponseSchema, `/api/observations/by-type/${encodeURIComponent(measurementCode)}`, { method: "DELETE" }),
  saveProfile: (profile: Omit<Profile, "id" | "updatedAt">) =>
    request(profileResponseSchema, "/api/profile", { method: "PUT", body: JSON.stringify(profile) }),
  cloudAiConsent: {
    get: () => request(cloudAiConsentResponseSchema, "/api/profile/cloud-ai-consent"),
    set: (payload: { enabled: boolean; providerScopeAccepted: boolean; consentVersion?: string }) =>
      request(cloudAiConsentResponseSchema, "/api/profile/cloud-ai-consent", { method: "PUT", body: JSON.stringify(payload) })
  },
  importObservationCsv: (fileName: string, content: string) =>
    request(importMutationResponseSchema, "/api/import/observations/csv", { method: "POST", body: JSON.stringify({ fileName, content }) }),
  previewBodyCompositionReport: (payload: { fileName: string; mimeType: string; contentBase64: string }) =>
    request(bodyCompositionDraftResponseSchema, "/api/import/body-composition/preview", { method: "POST", body: JSON.stringify(payload) }),
  commitBodyCompositionReport: (payload: BodyCompositionDraftCommitPayload) =>
    request(importMutationResponseSchema, "/api/import/body-composition/commit", { method: "POST", body: JSON.stringify(payload) }),
  previewBloodTestReport: (payload: { fileName: string; mimeType: string; contentBase64: string }) =>
    request(bodyCompositionDraftResponseSchema, "/api/import/blood-test/preview", { method: "POST", body: JSON.stringify(payload) }),
  commitBloodTestReport: (payload: BodyCompositionDraftCommitPayload) =>
    request(importMutationResponseSchema, "/api/import/blood-test/commit", { method: "POST", body: JSON.stringify(payload) }),
  importManualLabEntry: (payload: ManualLabEntryPayload) =>
    request(importMutationResponseSchema, "/api/import/labs/manual", { method: "POST", body: JSON.stringify(payload) }),
  importManualObservations: (payload: { observedAt: string; label: string; sourceName?: string; observations: Array<{ measurementName?: string; measurementCode?: string; value: number; unit?: string }> }) =>
    request(importMutationResponseSchema, "/api/import/observations/manual", { method: "POST", body: JSON.stringify(payload) }),
  generateInsight: () => request(insightResponseSchema, "/api/insights/generate", { method: "POST" }),
  pairing: {
    qr: async () => {
      const response = await fetchAsOwner("/api/pair/qr");
      await assertResponseOk(response);
      return response.blob();
    },
    pending: () => request(pendingPairingsResponseSchema, "/api/pairing/pending"),
    devices: () => request(pairedDevicesResponseSchema, "/api/pairing/devices"),
    approve: (id: string, profileId: string) =>
      request(pairingMutationResponseSchema, `/api/pairing/approve/${id}`, { method: "POST", body: JSON.stringify({ profileId }) }),
    deny: (id: string) => request(pairingMutationResponseSchema, `/api/pairing/deny/${id}`, { method: "POST" }),
    revoke: (id: string) => request(pairedDeviceSchema, `/api/pairing/revoke/${id}`, { method: "POST" })
  },
  profiles: {
    list: () => request(profilesResponseSchema, "/api/profiles"),
    create: (displayName: string) =>
      request(profileListEntrySchema, "/api/profiles", { method: "POST", body: JSON.stringify({ displayName }) }),
    active: () => request(profileIdResponseSchema, "/api/profiles/active"),
    setActive: (profileId: string) =>
      request(profileIdResponseSchema, "/api/profiles/active", { method: "PUT", body: JSON.stringify({ profileId }) }),
    remove: (profileId: string) =>
      request(profileDeleteResponseSchema, `/api/profiles/${encodeURIComponent(profileId)}`, { method: "DELETE" })
  },
  query: {
    ai: (question: string, options?: { timezone?: string; debug?: boolean }) =>
      request(aiQueryResponseSchema, "/api/query/ai", {
        method: "POST",
        body: JSON.stringify({ question, ...options })
      })
  },
  llm: {
    config: () => request(llmConfigResponseSchema, "/api/llm/config")
  },
  settings: {
    ai: {
      get: () => request(aiSettingsResponseSchema, "/api/settings/ai"),
      save: (payload: { provider: "ollama" | "openai"; endpoint: string; apiKey?: string; model: string; timeoutMs: number }) =>
        request(aiSettingsResponseSchema, "/api/settings/ai", { method: "PUT", body: JSON.stringify(payload) }),
      validate: () => request(modelValidationResponseSchema, "/api/settings/ai/validate", { method: "POST" })
    }
  }
};
