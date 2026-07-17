import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient, paginationQuery, type ApiTransportRequest } from "../index.js";

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Forbidden",
    headers: { get: (name: string) => name === "x-correlation-id" ? "header-correlation" : null },
    json: async () => body
  };
}

describe("createApiClient", () => {
  it("constructs pagination queries and encodes measurement codes", async () => {
    const transport = vi.fn(async (_request: ApiTransportRequest) => response({
      measurement: {},
      entries: [],
      chartPoints: [],
      pagination: {},
      sourceCounts: {},
      deletion: {}
    }));
    const client = createApiClient(transport);

    await client.healthDataDetail("blood pressure", { limit: 25, offset: 50 });

    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/summary/blood%20pressure?limit=25&offset=50",
      method: "GET"
    }));
    expect(paginationQuery()).toBe("");
  });

  it("serializes JSON requests while leaving authentication to the transport", async () => {
    const seen: ApiTransportRequest[] = [];
    const transport = async (request: ApiTransportRequest) => {
      seen.push({ ...request, headers: { ...request.headers, "x-companion-token": "injected-by-transport" } });
      return response({
        import: {
          id: "import-1",
          sourceKind: "manual-entry",
          fileName: "manual-entry",
          importedAt: "2026-01-01",
          parserVersion: "1",
          checksum: "abc",
          rowCount: 1,
          status: "success",
          diagnostics: []
        },
        outcome: Object.fromEntries([
          "sourceImport", "dataSource", "observations", "observationGroups", "timeSeriesSamples", "activitySessions"
        ].map((key) => [key, { attempted: 0, accepted: 0, duplicates: 0, evicted: 0 }]))
      });
    };

    await createApiClient(transport).importManualObservations({
      observedAt: "2026-01-01",
      label: "Body",
      observations: [{ measurementCode: "weight", value: 70, unit: "kg" }]
    });

    expect(seen[0]).toMatchObject({
      method: "POST",
      path: "/api/import/observations/manual",
      headers: { "content-type": "application/json", "x-companion-token": "injected-by-transport" }
    });
    expect(JSON.parse(seen[0].body!)).toMatchObject({ label: "Body" });
  });

  it("parses API errors with correlation IDs", async () => {
    const client = createApiClient(async () =>
      response({ error: "Not allowed", code: "CAPABILITY_REQUIRED", correlationId: "body-correlation" }, 403));

    await expect(client.summary()).rejects.toEqual(expect.objectContaining<ApiError>({
      name: "ApiError",
      message: "Not allowed",
      status: 403,
      code: "CAPABILITY_REQUIRED",
      correlationId: "body-correlation"
    }));
  });

  it("rejects malformed successful responses", async () => {
    const client = createApiClient(async () => response({ profiles: [{ id: "self" }] }));
    await expect(client.assignedProfiles()).rejects.toThrow();
  });

  it("posts generic structured-upload preview and commit requests", async () => {
    const seen: ApiTransportRequest[] = [];
    const transport = async (request: ApiTransportRequest) => {
      seen.push(request);
      if (request.path === "/api/import/upload/preview") {
        return response({
          fileName: "labs.csv",
          format: "csv",
          checksum: "sha256-test",
          parserVersion: "structured-upload-v1",
          columns: ["observedAt", "measurement", "value", "unit"],
          mapping: {},
          mappingSuggestion: {},
          rowCount: 1,
          diagnostics: [],
          rows: [],
          truncated: false
        });
      }
      return response({
        import: {
          id: "import-1",
          sourceKind: "structured-upload",
          fileName: "labs.csv",
          importedAt: "2026-01-01",
          parserVersion: "structured-upload-v1",
          checksum: "sha256-test",
          rowCount: 1,
          status: "processed",
          diagnostics: []
        },
        outcome: Object.fromEntries([
          "sourceImport", "dataSource", "observations", "observationGroups", "timeSeriesSamples", "activitySessions"
        ].map((key) => [key, { attempted: 0, accepted: 0, duplicates: 0, evicted: 0 }]))
      });
    };
    const client = createApiClient(transport);

    const draft = await client.previewStructuredUpload({ fileName: "labs.csv", content: "observedAt,measurement,value,unit\n2026-01-01,glucose,95,mg/dL" });
    expect(draft).not.toHaveProperty("layout");
    expect(seen[0]).toMatchObject({ method: "POST", path: "/api/import/upload/preview" });

    await client.commitStructuredUpload({
      fileName: "labs.csv",
      rows: [{
        id: "row-1",
        label: "glucose",
        measurementCode: "glucose",
        displayName: "Glucose",
        value: 95,
        unit: "mg/dL",
        confidence: "high",
        included: true
      }]
    });
    expect(seen[1]).toMatchObject({ method: "POST", path: "/api/import/upload/commit" });
  });
});
