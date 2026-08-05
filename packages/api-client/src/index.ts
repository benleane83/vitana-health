import {
  analyticsSummaryResponseSchema,
  apiErrorResponseSchema,
  appBootstrapResponseSchema,
  assignedProfilesResponseSchema,
  bodyTrendDateDetailResponseSchema,
  bodyTrendDateQuerySchema,
  bodyTrendQuerySchema,
  bodyTrendTimelineResponseSchema,
  bodyCompositionDraftResponseSchema,
  calendarMonthQuerySchema,
  calendarMonthResponseSchema,
  bloodTestDraftResponseSchema,
  careItemMutationResponseSchema,
  careItemListQuerySchema,
  completeCareItemInputSchema,
  completeCareItemResponseSchema,
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
  journalPageResponseSchema,
  journalQuerySchema,
  linkedHealthEventConflictSchema,
  mobileMigrationBatchAcknowledgementSchema,
  mobileMigrationBatchSchema,
  mobileMigrationCompletionRequestSchema,
  mobileMigrationReceiptSchema,
  mobileMigrationStartRequestSchema,
  healthConnectImportRequestSchema,
  mobileMigrationStartResponseSchema,
  measurementPinStateResponseSchema,
  paginatedCareItemsResponseSchema,
  paginatedHealthEventsResponseSchema,
  personalReferenceRangeInputSchema,
  profilePhotoDeleteResponseSchema,
  profilePhotoResponseSchema,
  profilePhotoUploadSchema,
  referenceRangeStateResponseSchema,
  sleepSessionListQuerySchema,
  sleepSessionPageResponseSchema,
  updateObservationResponseSchema,
  uploadImportDraftResponseSchema
} from "@vitana/shared";

export { BRAND_NAME, FORMAL_BRAND_NAME, PAIRING_APP, PUBLIC_DOMAIN } from "@vitana/shared";
import type {
  BodyCompositionDraftCommitPayload,
  BodyTrendDateQuery,
  BodyTrendQuery,
  CalendarMonthQuery,
  CareItemListQuery,
  CompleteCareItemInput,
  CreateCareItemInput,
  CreateHealthEventInput,
  HealthEventListQuery,
  HealthConnectImportPayload,
  JournalQueryInput,
  ManualObservationPayload,
  PersonalReferenceRangeInput,
  SleepSessionListQuery,
  UpdateObservationInput,
  MobileMigrationBatch,
  MobileMigrationCompletionRequest,
  MobileMigrationStartRequest,
  UploadImportCommitPayload,
  UploadImportPreviewPayload
} from "@vitana/shared";

export interface ApiTransportRequest {
  path: string;
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  headers: Readonly<Record<string, string>>;
  body?: string;
  /**
   * Aborts the in-flight request. Transports are expected to forward this to `fetch` (or the
   * native equivalent) so a superseded profile's response can never resolve and overwrite the
   * profile the user actually switched to.
   */
  signal?: AbortSignal;
}

export interface ApiTransportResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  headers?: { get(name: string): string | null };
  json(): Promise<unknown>;
  clone?(): ApiTransportResponse;
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
    options: {
      method?: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
      body?: unknown;
      signal?: AbortSignal;
    } = {}
  ): Promise<T> {
    const response = await transport({
      path,
      method: options.method ?? "GET",
      headers: {
        accept: "application/json",
        ...(options.body === undefined ? {} : { "content-type": "application/json" })
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal
    });
    if (!response.ok) throw await apiErrorFromResponse(response);
    return schema.parse(await response.json());
  }

  return {
    /**
     * Escape hatch for callers that need an endpoint this client does not wrap yet. It shares the
     * transport, error mapping and schema parsing, so there is never a second request pipeline to
     * keep in sync.
     */
    request,
    health: () => request(healthResponseSchema, "/api/health"),
    desktopUpdates: {
      get: () => request(desktopUpdateStateSchema, "/api/settings/updates"),
      check: () => request(desktopUpdateStateSchema, "/api/settings/updates/check", { method: "POST" }),
      download: () => request(desktopUpdateStateSchema, "/api/settings/updates/download", { method: "POST" }),
      restart: () => request(desktopUpdateStateSchema, "/api/settings/updates/restart", { method: "POST" })
    },
    assignedProfiles: (signal?: AbortSignal) => request(assignedProfilesResponseSchema, "/api/profiles", { signal }),
    bootstrap: (signal?: AbortSignal) => request(appBootstrapResponseSchema, "/api/bootstrap", { signal }),
    profilePhoto: {
      get: () => request(profilePhotoResponseSchema, "/api/profile/photo"),
      replace: (payload: { contentType: "image/jpeg"; contentBase64: string }) =>
        request(profilePhotoResponseSchema, "/api/profile/photo", {
          method: "PUT",
          body: profilePhotoUploadSchema.parse(payload)
        }),
      remove: () => request(profilePhotoDeleteResponseSchema, "/api/profile/photo", { method: "DELETE" })
    },
    analytics: (signal?: AbortSignal) => request(analyticsSummaryResponseSchema, "/api/analytics", { signal }),
    summary: (signal?: AbortSignal) => request(healthDataSummaryResponseSchema, "/api/summary", { signal }),
    bodyTrendTimeline: (query: BodyTrendQuery, signal?: AbortSignal) => {
      const validated = bodyTrendQuerySchema.parse(query);
      const params = `range=${encodeURIComponent(validated.range)}&timezone=${encodeURIComponent(validated.timezone)}`;
      return request(bodyTrendTimelineResponseSchema, `/api/body-trend?${params}`, { signal });
    },
    bodyTrendDateDetail: (date: string, query: BodyTrendDateQuery, signal?: AbortSignal) => {
      const validated = bodyTrendDateQuerySchema.parse(query);
      return request(
        bodyTrendDateDetailResponseSchema,
        `/api/body-trend/${encodeURIComponent(date)}?timezone=${encodeURIComponent(validated.timezone)}`,
        { signal }
      );
    },
    calendarMonth: (query: CalendarMonthQuery, signal?: AbortSignal) => {
      const validated = calendarMonthQuerySchema.parse(query);
      const params = [
        `month=${encodeURIComponent(validated.month)}`,
        `timezone=${encodeURIComponent(validated.timezone)}`,
        `measurementCodes=${encodeURIComponent(validated.measurementCodes.join(","))}`
      ];
      return request(calendarMonthResponseSchema, `/api/calendar?${params.join("&")}`, { signal });
    },
    journal: (query: JournalQueryInput, signal?: AbortSignal) => {
      const validated = journalQuerySchema.parse(query);
      const params = new URLSearchParams({
        timezone: validated.timezone,
        dayLimit: String(validated.dayLimit)
      });
      if (validated.beforeDate) params.set("beforeDate", validated.beforeDate);
      return request(journalPageResponseSchema, `/api/journal?${params.toString()}`, { signal });
    },
    sleepSessions: (page?: SleepSessionListQuery, signal?: AbortSignal) => {
      const validated = sleepSessionListQuerySchema.parse(page ?? {});
      return request(
        sleepSessionPageResponseSchema,
        `/api/sleep-sessions${paginationQuery(validated)}`,
        { signal }
      );
    },
    healthDataDetail: (
      measurementCode: string,
      page?: { limit?: number; offset?: number },
      signal?: AbortSignal
    ) =>
      request(
        healthDataDetailResponseSchema,
        `/api/summary/${encodeURIComponent(measurementCode)}${paginationQuery(page)}`,
        { signal }
      ),
    healthDataChartSeries: (
      measurementCode: string,
      options?: { range?: "all" | "1y" | "3m" | "1m"; mode?: "auto" | "raw" },
      signal?: AbortSignal
    ) =>
      request(
        healthDataChartSeriesResponseSchema,
        `/api/summary/${encodeURIComponent(measurementCode)}/chart${chartQuery(options)}`,
        { signal }
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
    pinMeasurement: (measurementCode: string) =>
      request(
        measurementPinStateResponseSchema,
        `/api/summary/${encodeURIComponent(measurementCode)}/pin`,
        { method: "PUT" }
      ),
    unpinMeasurement: (measurementCode: string) =>
      request(
        measurementPinStateResponseSchema,
        `/api/summary/${encodeURIComponent(measurementCode)}/pin`,
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
      request(bloodTestDraftResponseSchema, "/api/import/blood-test/preview", { method: "POST", body: payload }),
    commitBodyCompositionReport: (payload: BodyCompositionDraftCommitPayload) =>
      request(importMutationResponseSchema, "/api/import/body-composition/commit", { method: "POST", body: payload }),
    commitBloodTestReport: (payload: BodyCompositionDraftCommitPayload) =>
      request(importMutationResponseSchema, "/api/import/blood-test/commit", { method: "POST", body: payload }),
    previewStructuredUpload: (payload: UploadImportPreviewPayload) =>
      request(uploadImportDraftResponseSchema, "/api/import/upload/preview", { method: "POST", body: payload }),
    commitStructuredUpload: (payload: UploadImportCommitPayload) =>
      request(importMutationResponseSchema, "/api/import/upload/commit", { method: "POST", body: payload }),
    // Validated before it leaves the device: a malformed sync payload should fail loudly here
    // rather than be partially accepted or rejected with an opaque 400 after a large upload.
    importHealthConnect: (payload: HealthConnectImportPayload) =>
      request(importMutationResponseSchema, "/api/import/health-connect", {
        method: "POST",
        body: healthConnectImportRequestSchema.parse(payload)
      }),
    mobileMigration: {
      start: (payload: MobileMigrationStartRequest) =>
        request(mobileMigrationStartResponseSchema, "/api/companion/migrations", {
          method: "POST",
          body: mobileMigrationStartRequestSchema.parse(payload)
        }),
      uploadBatch: (payload: MobileMigrationBatch) =>
        request(
          mobileMigrationBatchAcknowledgementSchema,
          `/api/companion/migrations/${encodeURIComponent(payload.sessionId)}/batches`,
          { method: "POST", body: mobileMigrationBatchSchema.parse(payload) }
        ),
      complete: (payload: MobileMigrationCompletionRequest) =>
        request(
          mobileMigrationReceiptSchema,
          `/api/companion/migrations/${encodeURIComponent(payload.sessionId)}/complete`,
          { method: "POST", body: mobileMigrationCompletionRequestSchema.parse(payload) }
        )
    },
    listHealthEvents: (query: HealthEventListQuery = {}, signal?: AbortSignal) =>
      request(
        paginatedHealthEventsResponseSchema,
        `/api/care/health-events${careQuery(healthEventListQuerySchema.parse(query), query)}`,
        { signal }
      ),
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
    completeCareItem: (id: string, payload: CompleteCareItemInput) =>
      request(completeCareItemResponseSchema, `/api/care/items/${encodeURIComponent(id)}/complete`, { method: "POST", body: completeCareItemInputSchema.parse(payload) }),
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

/** Exported so callers doing raw (non-JSON) fetches can still surface consistent `ApiError`s. */
export async function apiErrorFromResponse(response: ApiTransportResponse): Promise<ApiError> {
  let payload: unknown;
  const fallbackResponse = response.clone?.();
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  let fallbackMessage = response.statusText || "API request failed.";
  if (payload === undefined && fallbackResponse?.text) {
    try {
      fallbackMessage = (await fallbackResponse.text()) || fallbackMessage;
    } catch {
      // The status message remains safe when neither parser can read the body.
    }
  }
  const parsed = apiErrorResponseSchema.safeParse(payload);
  const correlationId = parsed.success
    ? parsed.data.correlationId ?? response.headers?.get("x-correlation-id") ?? undefined
    : response.headers?.get("x-correlation-id") ?? undefined;
  return new ApiError(
    parsed.success ? parsed.data.error : fallbackMessage,
    response.status,
    parsed.success ? parsed.data.code : "HTTP_ERROR",
    correlationId,
    linkedHealthEventConflictSchema.safeParse(payload).success
      ? linkedHealthEventConflictSchema.parse(payload).linkedCareItems
      : parsed.success ? parsed.data : undefined
  );
}
