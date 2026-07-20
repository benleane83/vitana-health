import { describe, expect, it } from "vitest";
import type { ManualObservationPayload, Profile } from "@local-fitness-advisor/shared";
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
    subjectKind: "adult",
    units: "metric",
    updatedAt: "2026-07-18T05:00:00.000Z"
  };
}

describe("local profile repository", () => {
  it("persists a manual import through Dashboard, Track, detail, retry, and reopen", async () => {
    const state = createMemoryLocalStoreState();
    const first = new LocalProfileRepository(new MemoryLocalStore(state), profile("profile-a"));
    const imported = await first.importManualObservations(reading);
    expect(imported.outcome.observations).toEqual({ attempted: 1, accepted: 1, duplicates: 0 });
    expect((await first.analytics()).latestMetrics[0]).toMatchObject({ code: "weight", value: 72.5, unit: "kg" });
    expect((await first.summary()).totals).toMatchObject({ observations: 1, total: 1, types: 1 });
    expect((await first.healthDataDetail("weight")).entries[0]).toMatchObject({
      value: 72.5,
      sourceKind: "manual-entry"
    });

    const duplicate = await first.importManualObservations(reading);
    expect(duplicate.outcome.observations).toEqual({ attempted: 1, accepted: 0, duplicates: 1 });

    const reopened = new LocalProfileRepository(new MemoryLocalStore(state), profile("profile-a"));
    expect((await reopened.bootstrap()).counts.observations).toBe(1);
    expect((await reopened.healthDataDetail("weight")).entries).toHaveLength(1);
    await reopened.reset();
    const afterReset = new LocalProfileRepository(new MemoryLocalStore(state), profile("profile-a"));
    expect((await afterReset.bootstrap()).counts.observations).toBe(0);
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
