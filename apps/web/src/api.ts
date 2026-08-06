import type {
  BodyCompositionDraftCommitPayload,
  BackupCreateRequest,
  BackupInspectResponse,
  BackupRestoreResponse,
  CareItemListQuery,
  CompleteCareItemInput,
  CreateCareItemInput,
  CreateHealthEventInput,
  DeleteObservationResponse,
  DeleteObservationsByTypeResponse,
  DeleteCareItemResponse,
  DeleteHealthEventResponse,
  HealthEventListQuery,
  ManualLabEntryPayload,
  ManualObservationPayload,
  Profile,
  ProfileListEntry,
  RestoreDecision,
  UpdateObservationInput,
  UpdateObservationResponse,
  UploadImportCommitPayload,
  UploadImportPreviewPayload,
  AiQueryTurnContext,
  AiQueryResponse as SharedAiQueryResponse,
  AiSettingsResponse as SharedAiSettingsResponse,
  DesktopRuntimeSettingsResponse as SharedDesktopRuntimeSettingsResponse,
  DesktopRuntimeSettingsUpdate,
  DesktopUpdateState as SharedDesktopUpdateState,
  ImportMutationResponse as SharedImportMutationResponse,
  LlmConfigResponse as SharedLlmConfigResponse,
  ModelValidationResponse as SharedModelValidationResponse,
  MeasurementRegistryResetResponse as SharedMeasurementRegistryResetResponse,
  PairedDevice as SharedPairedDevice,
  PendingPairing as SharedPendingPairing,
  PaginatedResult,
  ProfilesResponse as SharedProfilesResponse
} from "@vitana/shared";
import {
  aiQueryResponseSchema,
  aiSettingsResponseSchema,
  analyticsSummaryResponseSchema,
  appBootstrapResponseSchema,
  backupInspectResponseSchema,
  backupRestoreResponseSchema,
  biologicalAgeResponseSchema,
  bodyCompositionDraftResponseSchema,
  cloudAiConsentResponseSchema,
  deleteObservationResponseSchema,
  deleteObservationsByTypeResponseSchema,
  desktopRuntimeSettingsResponseSchema,
  desktopUpdateStateSchema,
  entitlementResponseSchema,
  healthDataDetailResponseSchema,
  healthDataSummaryResponseSchema,
  healthResponseSchema,
  importMutationResponseSchema,
  insightResponseSchema,
  llmConfigResponseSchema,
  modelValidationResponseSchema,
  measurementRegistryResetResponseSchema,
  pairedDeviceSchema,
  pairedDevicesResponseSchema,
  pairingMutationResponseSchema,
  pendingPairingsResponseSchema,
  profilePhotoDeleteResponseSchema,
  profilePhotoResponseSchema,
  profilePhotoUploadSchema,
  profileDeleteResponseSchema,
  profileIdResponseSchema,
  profileListEntrySchema,
  profileResponseSchema,
  profilesResponseSchema,
  updateObservationResponseSchema
} from "@vitana/shared";
import { ApiError, apiErrorFromResponse, createApiClient } from "@vitana/api-client";
export { ApiError } from "@vitana/api-client";

const ownerTokenKey = "vitana.ownerToken";
const launchNonceKey = "vitana.launchNonce";
let ownerTokenPromptInFlight: Promise<string | null> | undefined;

/**
 * The desktop shell passes a per-launch nonce in the URL fragment. It is moved into session storage
 * (so a reload of this window keeps working) and cleared from the address bar straight away, then
 * presented when claiming the owner cookie. Nothing is present when the app is opened any other
 * way, in which case the server is not enforcing a nonce either.
 */
function captureLaunchNonce(): string | null {
  const match = /(?:^|[#&])launch=([^&]+)/.exec(window.location.hash);
  if (match) {
    window.sessionStorage.setItem(launchNonceKey, decodeURIComponent(match[1]));
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  return window.sessionStorage.getItem(launchNonceKey);
}

const launchNonce = captureLaunchNonce();

function ownerHeaders(options?: RequestInit): HeadersInit {
  const token = window.sessionStorage.getItem(ownerTokenKey);
  const headers = new Headers(options?.headers);
  if (!(options?.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (token && !headers.has("authorization")) {
    headers.set("authorization", "Bearer " + token);
  }
  return headers;
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
      headers: {
        accept: "application/json",
        ...(launchNonce ? { "x-vitana-launch-nonce": launchNonce } : {})
      }
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

/**
 * Asks the user for the owner token. Registered by the app shell so the request pipeline can reach
 * the accessible `ConfirmDialog` without importing React; when nothing is registered (tests, or a
 * failure before mount) the request simply surfaces its 401 rather than blocking the renderer on a
 * native `window.prompt`.
 */
export type OwnerTokenPrompt = () => Promise<string | null>;

let ownerTokenPrompt: OwnerTokenPrompt | undefined;

export function setOwnerTokenPrompt(handler: OwnerTokenPrompt | undefined): void {
  ownerTokenPrompt = handler;
}

async function promptForOwnerToken(): Promise<string | null> {
  if (!ownerTokenPrompt) return null;
  // Coalesced so a burst of parallel 401s raises one dialog rather than one per request.
  if (!ownerTokenPromptInFlight) {
    ownerTokenPromptInFlight = ownerTokenPrompt().finally(() => {
      ownerTokenPromptInFlight = undefined;
    });
  }
  return ownerTokenPromptInFlight;
}

async function assertResponseOk(response: Response): Promise<void> {
  if (!response.ok) throw await apiErrorFromResponse(response);
}

const sharedApi = createApiClient(async ({ path, method, headers, body, signal }) =>
  fetchAsOwner(path, { method, headers, body, signal }));

/**
 * The one request pipeline: owner-token injection lives in the transport above, so endpoints this
 * client does not wrap yet reuse the same error mapping and schema parsing instead of a second copy.
 */
const request = sharedApi.request;

export type AiQueryResult = SharedAiQueryResponse;
export type AiQueryRow = SharedAiQueryResponse["rows"][number];
export type AiQueryChart = NonNullable<SharedAiQueryResponse["chart"]>;
export type AiQueryChartSeries = AiQueryChart["series"][number];
export type PendingPairing = SharedPendingPairing;
export type PairedDevice = SharedPairedDevice;
export type LlmConfig = SharedLlmConfigResponse;
export type AiSettings = SharedAiSettingsResponse;
export type DesktopRuntimeSettings = SharedDesktopRuntimeSettingsResponse;
export type DesktopUpdateState = SharedDesktopUpdateState;
export type ModelValidation = SharedModelValidationResponse;
export type MeasurementRegistryResetResponse = SharedMeasurementRegistryResetResponse;
export type ProfilesResponse = SharedProfilesResponse;
export type ImportMutationResponse = SharedImportMutationResponse;

export type DeleteObservationMutationResponse = DeleteObservationResponse;
export type DeleteObservationsByTypeMutationResponse = DeleteObservationsByTypeResponse;
export type UpdateObservationMutationResponse = UpdateObservationResponse;
export type CareItemsResponse = Awaited<ReturnType<typeof sharedApi.listCareItems>>;
export type HealthEventsResponse = Awaited<ReturnType<typeof sharedApi.listHealthEvents>>;
export type DeleteCareItemMutationResponse = DeleteCareItemResponse;
export type DeleteHealthEventMutationResponse = DeleteHealthEventResponse;

export const api = {
  health: sharedApi.health,
  bootstrap: sharedApi.bootstrap,
  sleepSessions: sharedApi.sleepSessions,
  profilePhoto: {
    get: () => request(profilePhotoResponseSchema, "/api/profile/photo"),
    replace: (payload: { contentType: "image/jpeg"; contentBase64: string }) =>
      request(profilePhotoResponseSchema, "/api/profile/photo", {
        method: "PUT",
        body: profilePhotoUploadSchema.parse(payload)
      }),
    remove: () => request(profilePhotoDeleteResponseSchema, "/api/profile/photo", { method: "DELETE" })
  },
  analytics: sharedApi.analytics,
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
        filename: response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "backup.vitana-backup"
      };
    },
    inspect: async (file: Blob, passphrase: string): Promise<BackupInspectResponse> => {
      const body = new FormData();
      body.append("file", file, "backup.vitana-backup");
      body.append("passphrase", passphrase);
      const response = await fetchAsOwner("/api/backups/inspect", {
        method: "POST",
        body
      });
      await assertResponseOk(response);
      return backupInspectResponseSchema.parse(await response.json());
    },
    restore: async (file: Blob, passphrase: string, decisions: Array<{
      profileId: string;
      decision: RestoreDecision;
      acknowledgeReplacement?: string;
    }>): Promise<BackupRestoreResponse> => {
      const body = new FormData();
      body.append("file", file, "backup.vitana-backup");
      body.append("passphrase", passphrase);
      body.append("decisions", JSON.stringify(decisions));
      const response = await fetchAsOwner("/api/backups/restore", {
        method: "POST",
        body
      });
      await assertResponseOk(response);
      return backupRestoreResponseSchema.parse(await response.json());
    }
  },
  summary: sharedApi.summary,
  bodyTrendTimeline: sharedApi.bodyTrendTimeline,
  bodyTrendDateDetail: sharedApi.bodyTrendDateDetail,
  calendarMonth: sharedApi.calendarMonth,
  journal: sharedApi.journal,
  healthDataDetail: sharedApi.healthDataDetail,
  healthDataChartSeries: sharedApi.healthDataChartSeries,
  setPersonalReferenceRange: sharedApi.setPersonalReferenceRange,
  removePersonalReferenceRange: sharedApi.removePersonalReferenceRange,
  pinMeasurement: sharedApi.pinMeasurement,
  unpinMeasurement: sharedApi.unpinMeasurement,
  care: {
    listHealthEvents: (query?: HealthEventListQuery, signal?: AbortSignal) => sharedApi.listHealthEvents(query, signal),
    createHealthEvent: (payload: CreateHealthEventInput) => sharedApi.createHealthEvent(payload),
    updateHealthEvent: (id: string, payload: CreateHealthEventInput) => sharedApi.updateHealthEvent(id, payload),
    deleteHealthEvent: (id: string) => sharedApi.deleteHealthEvent(id),
    listCareItems: (query?: CareItemListQuery) => sharedApi.listCareItems(query),
    createCareItem: (payload: CreateCareItemInput) => sharedApi.createCareItem(payload),
    updateCareItem: (id: string, payload: CreateCareItemInput) => sharedApi.updateCareItem(id, payload),
    completeCareItem: (id: string, payload: CompleteCareItemInput) => sharedApi.completeCareItem(id, payload),
    deleteCareItem: (id: string) => sharedApi.deleteCareItem(id)
  },
  updateObservation: (id: string, input: UpdateObservationInput) =>
    request(updateObservationResponseSchema, `/api/observations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: input
    }),
  deleteObservation: (id: string) => request(deleteObservationResponseSchema, `/api/observations/${encodeURIComponent(id)}`, { method: "DELETE" }),
  deleteObservationsByType: (measurementCode: string) =>
    request(deleteObservationsByTypeResponseSchema, `/api/observations/by-type/${encodeURIComponent(measurementCode)}`, { method: "DELETE" }),
  saveProfile: (profile: Omit<Profile, "id" | "updatedAt">) =>
    request(profileResponseSchema, "/api/profile", { method: "PUT", body: profile }),
  cloudAiConsent: {
    get: () => request(cloudAiConsentResponseSchema, "/api/profile/cloud-ai-consent"),
    set: (payload: { enabled: boolean; providerScopeAccepted: boolean; consentVersion?: string }) =>
      request(cloudAiConsentResponseSchema, "/api/profile/cloud-ai-consent", { method: "PUT", body: payload })
  },
  measurementTypes: {
    resetFromRegistry: () => request(measurementRegistryResetResponseSchema, "/api/profile/measurement-types/reset", { method: "POST" })
  },
  previewBodyCompositionReport: sharedApi.previewBodyCompositionReport,
  commitBodyCompositionReport: sharedApi.commitBodyCompositionReport,
  previewBloodTestReport: sharedApi.previewBloodTestReport,
  commitBloodTestReport: sharedApi.commitBloodTestReport,
  previewStructuredUpload: (payload: UploadImportPreviewPayload) => sharedApi.previewStructuredUpload(payload),
  commitStructuredUpload: (payload: UploadImportCommitPayload) => sharedApi.commitStructuredUpload(payload),
  importManualLabEntry: (payload: ManualLabEntryPayload) =>
    request(importMutationResponseSchema, "/api/import/labs/manual", { method: "POST", body: payload }),
  importManualObservations: (payload: ManualObservationPayload) => sharedApi.importManualObservations(payload),
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
      request(pairingMutationResponseSchema, `/api/pairing/approve/${id}`, { method: "POST", body: { profileId } }),
    deny: (id: string) => request(pairingMutationResponseSchema, `/api/pairing/deny/${id}`, { method: "POST" }),
    revoke: (id: string) => request(pairedDeviceSchema, `/api/pairing/revoke/${id}`, { method: "POST" })
  },
  entitlement: {
    get: (signal?: AbortSignal) => request(entitlementResponseSchema, "/api/entitlement", { signal })
  },
  profiles: {
    list: (signal?: AbortSignal) => request(profilesResponseSchema, "/api/profiles", { signal }),
    create: (displayName: string) =>
      request(profileListEntrySchema, "/api/profiles", { method: "POST", body: { displayName } }),
    active: () => request(profileIdResponseSchema, "/api/profiles/active"),
    setActive: (profileId: string) =>
      request(profileIdResponseSchema, "/api/profiles/active", { method: "PUT", body: { profileId } }),
    remove: (profileId: string) =>
      request(profileDeleteResponseSchema, `/api/profiles/${encodeURIComponent(profileId)}`, { method: "DELETE" })
  },
  query: {
    ai: (question: string, options?: {
      timezone?: string;
      debug?: boolean;
      context?: AiQueryTurnContext;
      signal?: AbortSignal;
    }) =>
      request(aiQueryResponseSchema, "/api/query/ai", {
        method: "POST",
        body: {
          question,
          timezone: options?.timezone,
          debug: options?.debug,
          context: options?.context
        },
        signal: options?.signal
      })
  },
  llm: {
    config: () => request(llmConfigResponseSchema, "/api/llm/config")
  },
  settings: {
    desktop: {
      get: () => request(desktopRuntimeSettingsResponseSchema, "/api/settings/desktop"),
      save: (payload: DesktopRuntimeSettingsUpdate) =>
        request(desktopRuntimeSettingsResponseSchema, "/api/settings/desktop", {
          method: "PUT",
          body: payload
        })
    },
    updates: {
      get: () => request(desktopUpdateStateSchema, "/api/settings/updates"),
      check: () => request(desktopUpdateStateSchema, "/api/settings/updates/check", { method: "POST" }),
      download: () => request(desktopUpdateStateSchema, "/api/settings/updates/download", { method: "POST" }),
      restart: () => request(desktopUpdateStateSchema, "/api/settings/updates/restart", { method: "POST" })
    },
    ai: {
      get: () => request(aiSettingsResponseSchema, "/api/settings/ai"),
      save: (payload: { provider: "ollama" | "openai"; endpoint: string; apiKey?: string; model: string; timeoutMs: number }) =>
        request(aiSettingsResponseSchema, "/api/settings/ai", { method: "PUT", body: payload }),
      validate: () => request(modelValidationResponseSchema, "/api/settings/ai/validate", { method: "POST" })
    }
  }
};
