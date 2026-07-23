import {
  analyticsSummaryResponseSchema,
  apiErrorResponseSchema,
  appBootstrapResponseSchema,
  assignedProfilesResponseSchema,
  bodyCompositionDraftResponseSchema,
  careItemMutationResponseSchema,
  careItemListQuerySchema,
  createCareItemInputSchema,
  createHealthEventInputSchema,
  deleteCareItemResponseSchema,
  deleteHealthEventResponseSchema,
  deleteObservationResponseSchema,
  desktopUpdateStateSchema,
  healthDataChartSeriesResponseSchema,
  healthDataDetailResponseSchema,
  healthDataSummaryResponseSchema,
  healthEventListQuerySchema,
  healthEventMutationResponseSchema,
  healthResponseSchema,
  importMutationResponseSchema,
  linkedHealthEventConflictSchema,
  paginatedCareItemsResponseSchema,
  paginatedHealthEventsResponseSchema,
  personalReferenceRangeInputSchema,
  referenceRangeStateResponseSchema,
  updateObservationResponseSchema,
  uploadImportDraftResponseSchema
} from "@vitana/shared";

export { BRAND_NAME, FORMAL_BRAND_NAME, PAIRING_APP, PUBLIC_DOMAIN } from "@vitana/shared";
import type {
  BodyCompositionDraftCommitPayload,
  CareItemListQuery,
  CreateCareItemInput,
  CreateHealthEventInput,
  HealthEventListQuery,
  ManualObservationPayload,
  PersonalReferenceRangeInput,
  UpdateObservationInput,
  UploadImportCommitPayload,
  UploadImportPreviewPayload
} from "@vitana/shared";

export interface ApiTransportRequest {
  path: string;
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  headers: Readonly<Record<string, string>>;
  body?: string;
}

export interface ApiTransportResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  headers?: { get(name: string): string | null };
  json(): Promise<unknown>;
  text?(): Promise<string>;
}

export type ApiTransport = (request: ApiTransportRequest) => Promise<ApiTransportResponse>;

interface ResponseSchema<T> {
  parse(value: unknown): T;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly correlationId?: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function createApiClient(transport: ApiTransport) {
  async function request<T>(
    schema: ResponseSchema<T>,
    path: string,
    options: { method?: "GET" | "POST" | "PATCH" | "DELETE" | "PUT"; body?: unknown } = {}
  ): Promise<T> {
    const response = await transport({
      path,
      method: options.method ?? "GET",
      headers: {
        accept: "application/json",
        ...(options.body === undefined ? {} : { "content-type": "application/json" })
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    if (!response.ok) throw await apiErrorFromResponse(response);
    return schema.parse(await response.json());
  }

  return {
    health: () => request(healthResponseSchema, "/api/health"),
    desktopUpdates: {
      get: () => request(desktopUpdateStateSchema, "/api/settings/updates"),
      check: () => request(desktopUpdateStateSchema, "/api/settings/updates/check", { method: "POST" }),
      download: () => request(desktopUpdateStateSchema, "/api/settings/updates/download", { method: "POST" }),
      restart: () => request(desktopUpdateStateSchema, "/api/settings/updates/restart", { method: "POST" })
    },
    assignedProfiles: () => request(assignedProfilesResponseSchema, "/api/profiles"),
    bootstrap: () => request(appBootstrapResponseSchema, "/api/bootstrap"),
    analytics: () => request(analyticsSummaryResponseSchema, "/api/analytics"),
    summary: () => request(healthDataSummaryResponseSchema, "/api/summary"),
    healthDataDetail: (measurementCode: string, page?: { limit?: number; offset?: number }) =>
      request(
        healthDataDetailResponseSchema,
        `/api/summary/${encodeURIComponent(measurementCode)}${paginationQuery(page)}`
      ),
    healthDataChartSeries: (measurementCode: string, options?: { range?: "all" | "1y" | "3m" | "1m"; mode?: "auto" | "raw" }) =>
      request(
        healthDataChartSeriesResponseSchema,
        `/api/summary/${encodeURIComponent(measurementCode)}/chart${chartQuery(options)}`
      ),
    setPersonalReferenceRange: (measurementCode: string, input: PersonalReferenceRangeInput) =>
      request(
        referenceRangeStateResponseSchema,
        `/api/summary/${encodeURIComponent(measurementCode)}/reference-range`,
        { method: "PUT", body: personalReferenceRangeInputSchema.parse(input) }
      ),
    removePersonalReferenceRange: (measurementCode: string) =>
      request(
        referenceRangeStateResponseSchema,
        `/api/summary/${encodeURIComponent(measurementCode)}/reference-range`,
        { method: "DELETE" }
      ),
    importManualObservations: (payload: ManualObservationPayload) =>
      request(importMutationResponseSchema, "/api/import/observations/manual", { method: "POST", body: payload }),
    updateObservation: (id: string, input: UpdateObservationInput) =>
      request(
        updateObservationResponseSchema,
        `/api/observations/${encodeURIComponent(id)}`,
        { method: "PATCH", body: input }
      ),
    deleteObservation: (id: string) =>
      request(
        deleteObservationResponseSchema,
        `/api/observations/${encodeURIComponent(id)}`,
        { method: "DELETE" }
      ),
    previewBodyCompositionReport: (payload: ReportPreviewPayload) =>
      request(bodyCompositionDraftResponseSchema, "/api/import/body-composition/preview", { method: "POST", body: payload }),
    previewBloodTestReport: (payload: ReportPreviewPayload) =>
      request(bodyCompositionDraftResponseSchema, "/api/import/blood-test/preview", { method: "POST", body: payload }),
    commitBodyCompositionReport: (payload: BodyCompositionDraftCommitPayload) =>
      request(importMutationResponseSchema, "/api/import/body-composition/commit", { method: "POST", body: payload }),
    commitBloodTestReport: (payload: BodyCompositionDraftCommitPayload) =>
      request(importMutationResponseSchema, "/api/import/blood-test/commit", { method: "POST", body: payload }),
    previewStructuredUpload: (payload: UploadImportPreviewPayload) =>
      request(uploadImportDraftResponseSchema, "/api/import/upload/preview", { method: "POST", body: payload }),
    commitStructuredUpload: (payload: UploadImportCommitPayload) =>
      request(importMutationResponseSchema, "/api/import/upload/commit", { method: "POST", body: payload }),
    importHealthConnect: (payload: Record<string, unknown>) =>
      request(importMutationResponseSchema, "/api/import/health-connect", { method: "POST", body: payload }),
    listHealthEvents: (query: HealthEventListQuery = {}) =>
      request(paginatedHealthEventsResponseSchema, `/api/care/health-events${careQuery(healthEventListQuerySchema.parse(query), query)}`),
    createHealthEvent: (payload: CreateHealthEventInput) =>
      request(healthEventMutationResponseSchema, "/api/care/health-events", { method: "POST", body: createHealthEventInputSchema.parse(payload) }),
    updateHealthEvent: (id: string, payload: CreateHealthEventInput) =>
      request(healthEventMutationResponseSchema, `/api/care/health-events/${encodeURIComponent(id)}`, { method: "PATCH", body: createHealthEventInputSchema.parse(payload) }),
    deleteHealthEvent: (id: string) =>
      request(deleteHealthEventResponseSchema, `/api/care/health-events/${encodeURIComponent(id)}`, { method: "DELETE" }),
    listCareItems: (query: CareItemListQuery = {}) =>
      request(paginatedCareItemsResponseSchema, `/api/care/items${careQuery(careItemListQuerySchema.parse(query), query)}`),
    createCareItem: (payload: CreateCareItemInput) =>
      request(careItemMutationResponseSchema, "/api/care/items", { method: "POST", body: createCareItemInputSchema.parse(payload) }),
    updateCareItem: (id: string, payload: CreateCareItemInput) =>
      request(careItemMutationResponseSchema, `/api/care/items/${encodeURIComponent(id)}`, { method: "PATCH", body: createCareItemInputSchema.parse(payload) }),
    deleteCareItem: (id: string) =>
      request(deleteCareItemResponseSchema, `/api/care/items/${encodeURIComponent(id)}`, { method: "DELETE" })
  };
}

export interface ReportPreviewPayload {
  fileName: string;
  mimeType: "application/pdf" | "image/jpeg" | "image/png";
  contentBase64: string;
}

export function paginationQuery(page?: { limit?: number; offset?: number }): string {
  const values: string[] = [];
  if (page?.limit !== undefined) values.push(`limit=${encodeURIComponent(String(page.limit))}`);
  if (page?.offset !== undefined) values.push(`offset=${encodeURIComponent(String(page.offset))}`);
  return values.length ? `?${values.join("&")}` : "";
}

function careQuery(validated: Record<string, unknown>, raw?: { limit?: number; offset?: number }): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(validated)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  if (raw?.limit === undefined) params.delete("limit");
  if (raw?.offset === undefined) params.delete("offset");
  const query = params.toString();
  return query ? `?${query}` : "";
}

function chartQuery(options?: { range?: "all" | "1y" | "3m" | "1m"; mode?: "auto" | "raw" }): string {
  const values: string[] = [];
  if (options?.range !== undefined) values.push(`range=${encodeURIComponent(options.range)}`);
  if (options?.mode !== undefined) values.push(`mode=${encodeURIComponent(options.mode)}`);
  return values.length ? `?${values.join("&")}` : "";
}

async function apiErrorFromResponse(response: ApiTransportResponse): Promise<ApiError> {
  let payload: unknown;
  let text = "";
  try {
    if (response.text) {
      text = await response.text();
      payload = JSON.parse(text);
    } else {
      payload = await response.json();
    }
  } catch {
    payload = undefined;
  }
  const parsed = apiErrorResponseSchema.safeParse(payload);
  const correlationId = parsed.success
    ? parsed.data.correlationId ?? response.headers?.get("x-correlation-id") ?? undefined
    : response.headers?.get("x-correlation-id") ?? undefined;
  return new ApiError(
    parsed.success ? parsed.data.error : text || response.statusText || "API request failed.",
    response.status,
    parsed.success ? parsed.data.code : "HTTP_ERROR",
    correlationId,
    linkedHealthEventConflictSchema.safeParse(payload).success
      ? linkedHealthEventConflictSchema.parse(payload).linkedCareItems
      : parsed.success ? parsed.data : undefined
  );
}
