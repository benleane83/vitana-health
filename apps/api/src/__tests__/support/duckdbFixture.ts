import type { HealthStoreData } from "@local-fitness-advisor/shared";

export function createDuckDbHealthStoreFixture(): HealthStoreData {
  return {
    schemaVersion: 2,
    profile: {
      id: "profile-a",
      displayName: "Profile A",
      birthYear: 1985,
      sex: "not-specified",
      heightCm: 172.5,
      bloodType: "unknown",
      goalSummary: "Preserve the complete v2 domain.",
      cloudAiConsent: {
        enabled: false,
        providerScopeAccepted: false,
        consentVersion: "fixture-1"
      },
      units: "metric",
      updatedAt: "2026-07-12T10:00:00.000Z"
    },
    sourceImports: [{
      id: "import-1",
      sourceKind: "manual-entry",
      fileName: "fixture.csv",
      importedAt: "2026-07-12T10:01:00.000Z",
      parserVersion: "test-1",
      checksum: "fixture-checksum",
      rowCount: 1,
      status: "processed",
      diagnostics: ["fixture diagnostic"],
      rawContent: "sensitive raw source content"
    }],
    dataSources: [{
      id: "source-1",
      sourceKind: "manual-entry",
      label: "Fixture source",
      importId: "import-1",
      createdAt: "2026-07-12T10:01:00.000Z"
    }],
    devices: [{
      id: "device-1",
      label: "Fixture device",
      manufacturer: "Fixture maker",
      model: "F-1",
      sourceId: "source-1"
    }],
    measurementTypes: [{
      code: "weight",
      display: "Weight",
      category: "body",
      kind: "point",
      canonicalUnit: "kg",
      aliases: ["body weight"],
      fhirCode: "29463-7",
      loincCode: "29463-7",
      openMHealthSchema: "omh:body-weight:2.0",
      normalLow: 50,
      normalHigh: 100,
      referenceRanges: [{ low: 50, high: 100, unit: "kg", label: "Fixture range", source: "fixture" }],
      aggregation: "latest"
    }],
    observationGroups: [{
      id: "group-1",
      kind: "custom",
      label: "Fixture group",
      sourceId: "source-1",
      importId: "import-1",
      startAt: "2026-07-12T10:00:00.000Z",
      endAt: "2026-07-12T10:05:00.000Z",
      collectedAt: "2026-07-12T10:02:00.000Z",
      metadata: { order: 1, nullable: null }
    }],
    observations: [{
      id: "observation-z",
      measurementCode: "weight",
      observedAt: "2026-07-12T10:02:00.000Z",
      effectiveStart: "2026-07-12T10:00:00.000Z",
      effectiveEnd: "2026-07-12T10:05:00.000Z",
      value: 80.5,
      unit: "kg",
      sourceId: "source-1",
      observationGroupId: "group-1",
      deviceId: "device-1",
      note: "First by collection order, not ID.",
      sourceJson: { row: 1 }
    }, {
      id: "observation-a",
      measurementCode: "weight",
      observedAt: "2026-07-12T10:03:00.000Z",
      value: 80.4,
      unit: "kg",
      sourceId: "source-1",
      sourceJson: null
    }],
    timeSeriesSamples: [{
      id: "sample-1",
      measurementCode: "weight",
      startAt: "2026-07-12T10:00:00.000Z",
      endAt: "2026-07-12T10:05:00.000Z",
      value: 80.5,
      unit: "kg",
      sourceId: "source-1",
      deviceId: "device-1",
      sourceJson: { interval: true }
    }],
    activitySessions: [{
      id: "activity-1",
      activityType: "walking",
      startAt: "2026-07-12T09:00:00.000Z",
      endAt: "2026-07-12T09:30:00.000Z",
      durationMinutes: 30,
      energyKcal: 120.5,
      distanceMeters: 2500,
      sourceId: "source-1",
      sourceJson: { route: "fixture" }
    }],
    insights: [{
      id: "insight-1",
      createdAt: "2026-07-12T10:03:00.000Z",
      title: "Fixture insight",
      body: "Fixture body",
      evidence: ["observation-z", "observation-a"],
      confidence: "high",
      model: "deterministic",
      safetyNotice: "Fixture only"
    }],
    auditEvents: [{
      id: "audit-1",
      createdAt: "2026-07-12T10:04:00.000Z",
      eventType: "import-processed",
      detail: "Fixture import processed."
    }]
  };
}