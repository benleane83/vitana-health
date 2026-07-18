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
});
