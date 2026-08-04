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

const entityCounts = {
  imports: 0,
  observations: 0,
  samples: 0,
  activities: 0,
  healthEvents: 0,
  careItems: 0
};

const sourceCounts = { observations: 0, samples: 0, activities: 0 };

const measurementRow = {
  code: "blood pressure",
  displayName: "Blood pressure",
  category: "cardio" as const,
  counts: { ...sourceCounts, total: 0 }
};

describe("createApiClient", () => {
  it("encodes calendar queries deterministically and forwards abort signals", async () => {
    const transport = vi.fn(async (_request: ApiTransportRequest) => response({
      month: "2026-08",
      timezone: "America/New_York",
      measurements: [],
      events: []
    }));
    const client = createApiClient(transport);
    const controller = new AbortController();

    await client.calendarMonth({
      month: "2026-08",
      timezone: "America/New_York",
      measurementCodes: ["steps", "resting_heart_rate"]
    }, controller.signal);

    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/calendar?month=2026-08&timezone=America%2FNew_York&measurementCodes=steps%2Cresting_heart_rate",
      method: "GET",
      signal: controller.signal
    }));
  });

  it("uses dedicated desktop update operations", async () => {
    const seen: ApiTransportRequest[] = [];
    const client = createApiClient(async (request) => {
      seen.push(request);
      return response({ status: "idle", currentVersion: "1.0.0", channel: "production", distributionChannel: "github" });
    });

    await client.desktopUpdates.get();
    await client.desktopUpdates.check();
    await client.desktopUpdates.download();
    await client.desktopUpdates.restart();

    expect(seen.map(({ path, method }) => ({ path, method }))).toEqual([
      { path: "/api/settings/updates", method: "GET" },
      { path: "/api/settings/updates/check", method: "POST" },
      { path: "/api/settings/updates/download", method: "POST" },
      { path: "/api/settings/updates/restart", method: "POST" }
    ]);
  });

  it("constructs pagination queries and encodes measurement codes", async () => {
    const transport = vi.fn(async (_request: ApiTransportRequest) => response({
      generatedAt: "2026-07-28T12:00:00.000Z",
      measurement: measurementRow,
      isPinned: false,
      referenceRange: { source: "none" },
      entries: [],
      chartPoints: [],
      counts: { ...sourceCounts, total: 0 },
      deletion: { observationEntries: 0, deletableEntries: 0 },
      pagination: { limit: 25, loaded: 0, total: 0, hasMore: false }
    }));
    const client = createApiClient(transport);

    await client.healthDataDetail("blood pressure", { limit: 25, offset: 50 });

    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/summary/blood%20pressure?limit=25&offset=50",
      method: "GET"
    }));
    expect(paginationQuery()).toBe("");
  });

  it("sets and removes encoded personal reference ranges", async () => {
    const seen: ApiTransportRequest[] = [];
    const transport = async (request: ApiTransportRequest) => {
      seen.push(request);
      return response({ source: request.method === "PUT" ? "personal" : "catalog" });
    };
    const client = createApiClient(transport);

    await client.setPersonalReferenceRange("blood pressure", { low: 4, high: 6, unit: "mmol/L" });
    await client.removePersonalReferenceRange("blood pressure");

    expect(seen[0]).toMatchObject({
      method: "PUT",
      path: "/api/summary/blood%20pressure/reference-range",
      body: JSON.stringify({ low: 4, high: 6, unit: "mmol/L" })
    });

    expect(seen[1]).toMatchObject({
      method: "DELETE",
      path: "/api/summary/blood%20pressure/reference-range"
    });
  });

  it("pins and unpins encoded measurement codes", async () => {
    const seen: ApiTransportRequest[] = [];
    const client = createApiClient(async (request) => {
      seen.push(request);
      return response({
        measurementCode: "blood pressure",
        isPinned: request.method === "PUT",
        ...(request.method === "PUT" ? { pinnedAt: "2026-07-28T12:00:00.000Z" } : {})
      });
    });

    await client.pinMeasurement("blood pressure");
    await client.unpinMeasurement("blood pressure");

    expect(seen.map(({ path, method }) => ({ path, method }))).toEqual([
      { path: "/api/summary/blood%20pressure/pin", method: "PUT" },
      { path: "/api/summary/blood%20pressure/pin", method: "DELETE" }
    ]);
  });

  it("updates and deletes encoded observation IDs", async () => {
    const seen: ApiTransportRequest[] = [];
    const transport = async (request: ApiTransportRequest) => {
      seen.push(request);
      return response(request.method === "PATCH"
        ? {
            updatedObservation: {
              id: "observation/1",
              measurementCode: "weight",
              observedAt: "2026-07-19T08:00:00.000Z",
              value: 71,
              unit: "kg",
              sourceId: "manual"
            },
            counts: entityCounts
          }
        : { deletedCount: 1, counts: entityCounts });
    };
    const client = createApiClient(transport);
    const input = {
      measurementCode: "weight",
      observedAt: "2026-07-19T08:00:00.000Z",
      value: 71,
      unit: "kg"
    };

    await client.updateObservation("observation/1", input);
    await client.deleteObservation("observation/1");

    expect(seen[0]).toMatchObject({
      method: "PATCH",
      path: "/api/observations/observation%2F1",
      body: JSON.stringify(input)
    });
    expect(seen[1]).toMatchObject({
      method: "DELETE",
      path: "/api/observations/observation%2F1"
    });
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
          "sourceImport", "dataSource", "observations", "observationGroups", "timeSeriesSamples", "measurementAggregates", "activitySessions"
        ].map((key) => [key, { attempted: 0, accepted: 0, duplicates: 0, rejected: 0 }]))
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

  it("uses the resumable companion migration endpoints", async () => {
    const seen: ApiTransportRequest[] = [];
    const transport = async (request: ApiTransportRequest) => {
      seen.push(request);
      if (request.path.endsWith("/batches")) {
        return response({
          sessionId: "session/1",
          batchId: "batch-1",
          counts: { accepted: 0, duplicates: 1, conflicts: 0 },
          duplicates: [{ entityType: "observation", entityId: "observation-1", classification: "exact-id" }],
          conflicts: []
        });
      }
      if (request.path.endsWith("/complete")) {
        return response({
          receiptId: "receipt-1",
          sessionId: "session/1",
          pairingId: "pairing-1",
          destinationProfileId: "profile-1",
          datasetFingerprint: "standalone:dataset-1",
          completedAt: "2026-07-25T00:00:00.000Z",
          counts: { accepted: 0, duplicates: 1, conflicts: 0 }
        });
      }
      return response({
        sessionId: "session/1",
        destinationProfileId: "profile-1",
        processedBatchIds: [],
        completed: false
      }, 201);
    };
    const client = createApiClient(transport);
    const manifest = {
      protocolVersion: 1 as const,
      datasetId: "dataset-1",
      datasetFingerprint: "standalone:dataset-1",
      sourceProfileId: "mobile-profile",
      counts: { sourceImports: 0, dataSources: 0, observationGroups: 0, observations: 1 }
    };

    const started = await client.mobileMigration.start({ manifest });
    const acknowledgement = await client.mobileMigration.uploadBatch({
      protocolVersion: 1,
      sessionId: started.sessionId,
      batchId: "batch-1",
      sourceImports: [],
      dataSources: [],
      observationGroups: [],
      observations: []
    });
    await client.mobileMigration.complete({ protocolVersion: 1, sessionId: started.sessionId });

    expect(acknowledgement.duplicates[0]?.classification).toBe("exact-id");
    expect(seen.map(({ method, path }) => ({ method, path }))).toEqual([
      { method: "POST", path: "/api/companion/migrations" },
      { method: "POST", path: "/api/companion/migrations/session%2F1/batches" },
      { method: "POST", path: "/api/companion/migrations/session%2F1/complete" }
    ]);
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
          "sourceImport", "dataSource", "observations", "observationGroups", "timeSeriesSamples", "measurementAggregates", "activitySessions"
        ].map((key) => [key, { attempted: 0, accepted: 0, duplicates: 0, rejected: 0 }]))
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

  it("supports paginated care queries and mutation methods", async () => {
    const seen: ApiTransportRequest[] = [];
    const transport = async (request: ApiTransportRequest) => {
      seen.push(request);
      if (request.path.startsWith("/api/care/health-events") && request.method === "GET") {
        return response({ items: [], total: 0, offset: 0, limit: 10, hasMore: false });
      }
      if (request.path.startsWith("/api/care/items") && request.method === "GET") {
        return response({ items: [], total: 0, offset: 0, limit: 10, hasMore: false });
      }
      if (request.path === "/api/care/health-events" && request.method === "POST") {
        return response({ healthEvent: { id: "event-1", kind: "other", status: "completed", occurredAt: "2026-01-01T00:00:00.000Z", source: "manual-entry" }, counts: { imports: 0, observations: 0, samples: 0, activities: 0, healthEvents: 1, careItems: 0 } });
      }
      if (request.path === "/api/care/items/care-1/complete" && request.method === "POST") {
        return response({
          careItem: { id: "care-1", title: "Book check-in", kind: "routine-checkup", priority: "normal", status: "completed", completedAt: "2026-01-02T00:00:00.000Z", completedHealthEventId: "event-2" },
          healthEvent: { id: "event-2", kind: "visit", status: "completed", occurredAt: "2026-01-02T00:00:00.000Z", source: "manual-entry" },
          counts: { imports: 0, observations: 0, samples: 0, activities: 0, healthEvents: 1, careItems: 1 }
        });
      }
      return response({ careItem: { id: "care-1", title: "Book check-in", kind: "routine-checkup", priority: "normal", status: "open" }, counts: { imports: 0, observations: 0, samples: 0, activities: 0, healthEvents: 0, careItems: 1 } });
    };
    const client = createApiClient(transport);

    await client.listHealthEvents({ limit: 10, search: "demo" });
    await client.createHealthEvent({ kind: "other", status: "completed", occurredAt: "2026-01-01T00:00:00.000Z" });
    await client.listCareItems({ limit: 10, status: "open", kind: "routine-checkup" });
    await client.createCareItem({ title: "Book check-in", kind: "routine-checkup", priority: "normal", status: "open" });
    await client.completeCareItem("care-1", { occurredAt: "2026-01-02T00:00:00.000Z", kind: "visit" });

    expect(seen[0]).toMatchObject({ method: "GET", path: "/api/care/health-events?limit=10&search=demo" });
    expect(seen[1]).toMatchObject({ method: "POST", path: "/api/care/health-events" });
    expect(seen[2]).toMatchObject({ method: "GET", path: "/api/care/items?limit=10&kind=routine-checkup&status=open" });
    expect(seen[3]).toMatchObject({ method: "POST", path: "/api/care/items" });
    expect(seen[4]).toMatchObject({
      method: "POST",
      path: "/api/care/items/care-1/complete",
      body: JSON.stringify({ occurredAt: "2026-01-02T00:00:00.000Z", kind: "visit" })
    });
  });
});
