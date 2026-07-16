import {
  analyticsSummaryResponseSchema,
  apiErrorResponseSchema,
  appBootstrapResponseSchema,
  assignedProfilesResponseSchema,
  bodyCompositionDraftResponseSchema,
  healthDataChartSeriesResponseSchema,
  healthDataDetailResponseSchema,
  healthDataSummaryResponseSchema,
  healthResponseSchema,
  importMutationResponseSchema
} from "@local-fitness-advisor/shared";
import type {
  BodyCompositionDraftCommitPayload,
  ManualObservationPayload
} from "@local-fitness-advisor/shared";

export interface ApiTransportRequest {
  path: string;
  method: "GET" | "POST";
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
    readonly correlationId?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function createApiClient(transport: ApiTransport) {
  async function request<T>(
    schema: ResponseSchema<T>,
    path: string,
    options: { method?: "GET" | "POST"; body?: unknown } = {}
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
    importManualObservations: (payload: ManualObservationPayload) =>
      request(importMutationResponseSchema, "/api/import/observations/manual", { method: "POST", body: payload }),
    previewBodyCompositionReport: (payload: ReportPreviewPayload) =>
      request(bodyCompositionDraftResponseSchema, "/api/import/body-composition/preview", { method: "POST", body: payload }),
    previewBloodTestReport: (payload: ReportPreviewPayload) =>
      request(bodyCompositionDraftResponseSchema, "/api/import/blood-test/preview", { method: "POST", body: payload }),
    commitBodyCompositionReport: (payload: BodyCompositionDraftCommitPayload) =>
      request(importMutationResponseSchema, "/api/import/body-composition/commit", { method: "POST", body: payload }),
    commitBloodTestReport: (payload: BodyCompositionDraftCommitPayload) =>
      request(importMutationResponseSchema, "/api/import/blood-test/commit", { method: "POST", body: payload }),
    importHealthConnect: (payload: Record<string, unknown>) =>
      request(importMutationResponseSchema, "/api/import/health-connect", { method: "POST", body: payload })
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
    correlationId
  );
}
