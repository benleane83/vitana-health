import { describe, expect, it } from "vitest";
import type { ManualObservationPayload, MobileMigrationBatch, Profile } from "@vitana/shared";
import { LocalProfileRepository } from "./localRepository";
import {
  MemoryLocalStore,
  createMemoryLocalStoreState
} from "./memoryLocalStore";

const reading: ManualObservationPayload = {
  observedAt: "2026-07-18T06:00:00.000Z",
  label: "Body",
  observations: [{
    measurementCode: "weight",
    measurementName: "Weight",
    value: 72.5,
    unit: "kg"
  }]
};

function profile(id: string): Profile {
  return {
    id,
    displayName: id === "profile-a" ? "Alex" : "Bailey",
    setupStatus: "complete",
    subjectKind: "adult",
    units: "metric",
    updatedAt: "2026-07-18T05:00:00.000Z"
  };
}

describe("local profile repository", () => {
  it("persists and manages standalone care records across repository recreation", async () => {
    const state = createMemoryLocalStoreState();
    const repository = new LocalProfileRepository(new MemoryLocalStore(state), profile("profile-a"));
    const created = await repository.createCareItem({
      title: "Annual check-up",
      kind: "visit",
      dueStart: "2026-08-20T09:00:00.000Z",
      priority: "high",
      status: "open",
      notes: "Bring medication list"
    });

    expect((await repository.listCareItems({ status: "open", limit: 1 })).items).toEqual([
      expect.objectContaining({ id: created.careItem.id, title: "Annual check-up" })
    ]);
    const completed = await repository.completeCareItem(created.careItem.id, {
      occurredAt: "2026-08-19T09:00:00.000Z"
    });
    expect(completed).toMatchObject({
      careItem: { status: "completed", completedAt: "2026-08-19T09:00:00.000Z" },
      healthEvent: { kind: "visit", status: "completed" },
      counts: { careItems: 1, healthEvents: 1 }
    });
    expect((await repository.listCareItems({ status: "open", includeId: created.careItem.id })).items[0])
      .toMatchObject({ id: created.careItem.id, status: "completed" });

    const reopened = new LocalProfileRepository(new MemoryLocalStore(state), profile("profile-a"));
    expect((await reopened.listHealthEvents({ kind: "visit" })).items).toHaveLength(1);
    await reopened.updateHealthEvent(completed.healthEvent!.id, {
      kind: "visit",
      status: "completed",
      occurredAt: "2026-08-19T10:00:00.000Z",
      provider: "Dr Patel"
    });
    expect((await reopened.listHealthEvents({ search: "patel" })).items[0].provider).toBe("Dr Patel");
    expect((await reopened.deleteCareItem(created.careItem.id)).deletedCount).toBe(1);
    expect((await reopened.bootstrap()).counts).toMatchObject({ careItems: 0, healthEvents: 1 });
  });

  it("persists a manual import through Dashboard, Track, detail, retry, and reopen", async () => {
    const state = createMemoryLocalStoreState();
    const first = new LocalProfileRepository(new MemoryLocalStore(state), profile("profile-a"));
    const imported = await first.importManualObservations(reading);
    expect(imported.outcome.observations).toEqual({ attempted: 1, accepted: 1, duplicates: 0, rejected: 0 });
    expect((await first.analytics()).latestMetrics[0]).toMatchObject({ code: "weight", value: 72.5, unit: "kg" });
    expect((await first.summary()).totals).toMatchObject({ observations: 1, total: 1, types: 1 });
    expect((await first.healthDataDetail("weight")).entries[0]).toMatchObject({
      value: 72.5,
      sourceKind: "manual-entry"
    });
    expect(await first.calendarMonth({ month: "2026-07", timezone: "UTC", measurementCodes: ["weight"] }))
      .toMatchObject({
        month: "2026-07",
        measurements: [{ date: "2026-07-18", measurementCode: "weight", value: 72.5, count: 1 }]
      });

    const duplicate = await first.importManualObservations(reading);
    expect(duplicate.outcome.observations).toEqual({ attempted: 1, accepted: 0, duplicates: 1, rejected: 0 });

    const reopened = new LocalProfileRepository(new MemoryLocalStore(state), profile("profile-a"));
    expect((await reopened.bootstrap()).counts.observations).toBe(1);
    expect((await reopened.healthDataDetail("weight")).entries).toHaveLength(1);
    await reopened.reset();
    const afterReset = new LocalProfileRepository(new MemoryLocalStore(state), profile("profile-a"));
    expect((await afterReset.bootstrap()).counts.observations).toBe(0);
  });

  it("projects a grouped standalone body-composition import into Body Trend", async () => {
    const repository = new LocalProfileRepository(new MemoryLocalStore(), profile("profile-a"));
    await repository.importManualObservations({
      observedAt: "2026-07-18T06:00:00.000Z",
      label: "Smart scale",
      observations: [
        { measurementCode: "skeletal_muscle_mass", measurementName: "Skeletal muscle mass", value: 31, unit: "kg" },
        { measurementCode: "fat_mass", measurementName: "Fat mass", value: 20, unit: "kg" },
        { measurementCode: "bone_mineral_content", measurementName: "Bone mineral content", value: 3.2, unit: "kg" },
        { measurementCode: "weight", measurementName: "Weight", value: 74.2, unit: "kg" }
      ]
    });

    const result = await repository.bodyTrendTimeline({ range: "all", timezone: "UTC" });
    expect(result.points).toEqual([
      expect.objectContaining({
        date: "2026-07-18",
        components: { muscleMass: 31, fatMass: 20, boneMineralContent: 3.2, weight: 74.2 }
      })
    ]);
  });

  it.each([
    ["Body", "body"],
    ["Lab", "lab"]
  ] as const)("categorizes a custom %s measurement as %s", async (label, category) => {
    const repository = new LocalProfileRepository(new MemoryLocalStore(), profile("profile-a"));
    await repository.importManualObservations({
      ...reading,
      label,
      observations: [{
        measurementCode: "manual_custom_score",
        measurementName: "Custom score",
        value: 7,
        unit: "points"
      }]
    });

    expect((await repository.summary()).categories[0].key).toBe(category);
    expect((await repository.healthDataDetail("manual_custom_score")).measurement.category).toBe(category);
  });

  it("keeps the latest reading for every measurement code in analytics", async () => {
    const state = createMemoryLocalStoreState();
    state.observations.set("profile-a\u0000weight-old", {
      id: "weight-old",
      measurementCode: "weight",
      observedAt: "2025-01-01T00:00:00.000Z",
      value: 72.5,
      unit: "kg",
      sourceId: "source-a"
    });
    for (let index = 0; index < 501; index += 1) {
      state.observations.set(`profile-a\u0000heart-rate-${index}`, {
        id: `heart-rate-${index}`,
        measurementCode: "heart_rate",
        observedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
        value: 60 + (index % 20),
        unit: "bpm",
        sourceId: "source-a"
      });
    }
    const repository = new LocalProfileRepository(new MemoryLocalStore(state), profile("profile-a"));

    expect((await repository.analytics()).latestMetrics.map((metric) => metric.code)).toEqual([
      "heart_rate",
      "weight"
    ]);
  });

  it("isolates stable import IDs between family profiles", async () => {
    const state = createMemoryLocalStoreState();
    const alex = new LocalProfileRepository(new MemoryLocalStore(state), profile("profile-a"));
    const bailey = new LocalProfileRepository(new MemoryLocalStore(state), profile("profile-b"));
    await alex.importManualObservations(reading);
    expect((await bailey.bootstrap()).counts.observations).toBe(0);
    await bailey.importManualObservations(reading);
    expect((await alex.bootstrap()).counts.observations).toBe(1);
    expect((await bailey.bootstrap()).counts.observations).toBe(1);
  });

  it("exports dependency-ordered batches and makes a migrated dataset read-only", async () => {
    const repository = new LocalProfileRepository(new MemoryLocalStore(), profile("profile-a"));
    await repository.importManualObservations(reading);
    const manifest = await repository.migrationManifest();
    const batches: MobileMigrationBatch[] = [];
    for await (const batch of repository.streamMigrationBatches("session-1")) {
      batches.push(batch);
    }

    expect(manifest.counts).toEqual({
      sourceImports: 1,
      dataSources: 1,
      observationGroups: 1,
      observations: 1
    });
    expect(batches.map((batch) => batch.batchId.split("-000000")[0])).toEqual([
      "source-imports",
      "data-sources",
      "observation-groups",
      "observations"
    ]);

    await repository.archiveAfterMigration({
      receiptId: "receipt-1",
      sessionId: "session-1",
      pairingId: "pairing-1",
      destinationProfileId: "pc-profile",
      datasetFingerprint: manifest.datasetFingerprint,
      completedAt: "2026-07-25T00:00:00.000Z",
      counts: { accepted: 4, duplicates: 0, conflicts: 0 }
    }, "https://pc.local");
    await expect(repository.importManualObservations(reading)).rejects.toThrow("read-only archive");
  });

  it("creates a fresh writable dataset without reactivating a migrated archive", async () => {
    const store = new MemoryLocalStore();
    const repository = new LocalProfileRepository(store, profile("profile-a"));
    await repository.importManualObservations(reading);
    const manifest = await repository.migrationManifest();
    await repository.archiveAfterMigration({
      receiptId: "receipt-1",
      sessionId: "session-1",
      pairingId: "pairing-1",
      destinationProfileId: "pc-profile",
      datasetFingerprint: manifest.datasetFingerprint,
      completedAt: "2026-07-25T00:00:00.000Z",
      counts: { accepted: 4, duplicates: 0, conflicts: 0 }
    }, "https://pc.local");

    await repository.createFreshDataset(profile("profile-b"));
    expect(await repository.listDatasets()).toEqual(expect.arrayContaining([
      expect.objectContaining({ datasetId: "profile-a", lifecycleState: "archived", selected: false }),
      expect.objectContaining({ datasetId: "profile-b", lifecycleState: "active", selected: true })
    ]));
    await expect(repository.importManualObservations(reading)).resolves.toBeDefined();

    await repository.selectDataset("profile-a");
    await expect(repository.importManualObservations(reading)).rejects.toThrow("read-only archive");
  });

  it("deletes only the selected writable dataset", async () => {
    const store = new MemoryLocalStore();
    const repository = new LocalProfileRepository(store, profile("profile-a"));
    await repository.importManualObservations(reading);
    await repository.createFreshDataset(profile("profile-b"));
    await repository.importManualObservations({ ...reading, observedAt: "2026-07-19T06:00:00.000Z" });

    await repository.deleteSelectedDataset();
    expect(await repository.listDatasets()).toEqual([
      expect.objectContaining({ datasetId: "profile-a", selected: false })
    ]);
    await repository.selectDataset("profile-a");
    expect((await repository.bootstrap()).counts.observations).toBe(1);
  });

  it("deletes a selected read-only archive without affecting another dataset", async () => {
    const store = new MemoryLocalStore();
    const repository = new LocalProfileRepository(store, profile("profile-a"));
    await repository.importManualObservations(reading);
    const manifest = await repository.migrationManifest();
    await repository.archiveAfterMigration({
      receiptId: "receipt-1",
      sessionId: "session-1",
      pairingId: "pairing-1",
      destinationProfileId: "pc-profile",
      datasetFingerprint: manifest.datasetFingerprint,
      completedAt: "2026-07-25T00:00:00.000Z",
      counts: { accepted: 4, duplicates: 0, conflicts: 0 }
    }, "https://pc.local");
    await repository.createFreshDataset(profile("profile-b"));
    await repository.selectDataset("profile-a");

    await repository.deleteSelectedDataset();

    expect(await repository.listDatasets()).toEqual([
      expect.objectContaining({ datasetId: "profile-b", lifecycleState: "active", selected: false })
    ]);
  });

  it("does not archive records changed after a migration snapshot was started", async () => {
    const repository = new LocalProfileRepository(new MemoryLocalStore(), profile("profile-a"));
    await repository.importManualObservations(reading);
    const started = await repository.migrationManifest();
    await repository.updateObservation(
      (await repository.healthDataDetail("weight")).entries[0]!.id,
      { measurementCode: "weight", observedAt: reading.observedAt, value: 71, unit: "kg" }
    );

    await expect(repository.archiveAfterMigration({
      receiptId: "stale-receipt",
      sessionId: "session-1",
      pairingId: "pairing-1",
      destinationProfileId: "pc-profile",
      datasetFingerprint: started.datasetFingerprint,
      completedAt: "2026-07-25T00:00:00.000Z",
      counts: { accepted: 4, duplicates: 0, conflicts: 0 }
    }, "https://pc.local")).rejects.toThrow("changed during migration");

    await expect(repository.importManualObservations({
      ...reading,
      observedAt: "2026-07-19T06:00:00.000Z"
    })).resolves.toBeDefined();
  });

  it("updates and deletes an observation without affecting another profile", async () => {
    const state = createMemoryLocalStoreState();
    const alex = new LocalProfileRepository(new MemoryLocalStore(state), profile("profile-a"));
    const bailey = new LocalProfileRepository(new MemoryLocalStore(state), profile("profile-b"));
    await alex.importManualObservations(reading);
    await bailey.importManualObservations(reading);
    const entry = (await alex.healthDataDetail("weight")).entries[0];

    const updated = await alex.updateObservation(entry.id, {
      measurementCode: "weight",
      observedAt: "2026-07-19T07:30:00.000Z",
      value: 71.25,
      unit: "kg",
      note: "After breakfast"
    });

    expect(updated?.updatedObservation).toMatchObject({
      value: 71.25,
      note: "After breakfast"
    });
    expect((await alex.healthDataDetail("weight")).entries[0]).toMatchObject({
      value: 71.25,
      canDelete: true
    });
    expect((await bailey.healthDataDetail("weight")).entries[0].value).toBe(72.5);

    expect((await alex.deleteObservation(entry.id))?.deletedCount).toBe(1);
    expect((await alex.bootstrap()).counts.observations).toBe(0);
    expect((await bailey.bootstrap()).counts.observations).toBe(1);
  });
});
