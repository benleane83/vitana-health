import { describe, expect, it } from "vitest";
import { createDemoDataSource } from "./demoDataSource";

describe("demo data source", () => {
  it("returns coherent dashboard, summary, and detail data", async () => {
    const source = createDemoDataSource(new Date("2026-07-17T12:00:00.000Z"));
    const [bootstrap, analytics, summary] = await Promise.all([
      source.bootstrap(),
      source.analytics(),
      source.summary()
    ]);

    expect(bootstrap.profile.displayName).toBe("Demo Profile");
    expect(analytics.latestMetrics.length).toBeGreaterThan(3);
    expect(summary.totals.types).toBe(analytics.latestMetrics.length);
    expect(summary.totals.samples).toBe(analytics.counts.samples);
    expect(summary.totals.observations).toBe(analytics.counts.observations);
    for (const metric of analytics.latestMetrics) {
      const detail = await source.healthDataDetail(metric.code);
      expect(detail.measurement.displayName).toBe(metric.label);
      expect(detail.entries[0].value).toBe(metric.value);
      expect(detail.chartPoints.length).toBe(detail.entries.length);
    }
  });

  it("paginates deterministically and rejects unknown metrics", async () => {
    const source = createDemoDataSource(new Date("2026-07-17T12:00:00.000Z"));
    const first = await source.healthDataDetail("steps", { limit: 2, offset: 0 });
    const second = await source.healthDataDetail("steps", { limit: 2, offset: 2 });

    expect(first.entries).toHaveLength(2);
    expect(first.pagination.hasMore).toBe(true);
    expect(second.entries).toHaveLength(2);
    expect(second.entries[0].id).not.toBe(first.entries[0].id);
    await expect(source.healthDataDetail("unknown")).rejects.toThrow("not available in demo mode");
  });

  it("returns valid Journal days and pages older dates with the server cursor contract", async () => {
    const source = createDemoDataSource(new Date("2026-07-17T12:00:00.000Z"));
    const first = await source.journal({ timezone: "UTC", dayLimit: 2 });

    expect(first.days.map((day) => day.date)).toEqual(["2026-07-17", "2026-07-16"]);
    expect(first.nextBeforeDate).toBe("2026-07-16");
    expect(first.days[0]?.items.map((item) => item.kind)).toEqual(["activity", "sleep"]);
    expect(new Date(first.days[0]!.items[0]!.occurredAt).toISOString()).toBe(first.days[0]!.items[0]!.occurredAt);

    const older = await source.journal({ timezone: "UTC", dayLimit: 2, beforeDate: first.nextBeforeDate });
    expect(older.days.map((day) => day.date)).toEqual(["2026-07-14"]);
    expect(older.nextBeforeDate).toBeUndefined();
  });

  it("returns complete grouped Body Trend readings", async () => {
    const source = createDemoDataSource(new Date("2026-07-17T12:00:00.000Z"));
    const result = await source.bodyTrendTimeline({ range: "3m", timezone: "UTC" });

    expect(result.points).toHaveLength(4);
    expect(result.points.at(-1)).toMatchObject({
      sourceLabel: "Demo smart scale",
      components: {
        muscleMass: 31.3,
        fatMass: 19.6,
        boneMineralContent: 3.2,
        weight: 73.8
      }
    });
  });

  it("classifies ranged samples without inventing a status for range-less metrics", async () => {
    const source = createDemoDataSource(new Date("2026-07-17T12:00:00.000Z"));
    const oxygen = await source.healthDataDetail("oxygen_saturation");
    const steps = await source.healthDataDetail("steps");

    expect(oxygen.entries[0]).toMatchObject({
      referenceRange: { low: 92, high: 100, unit: "%" },
      status: "normal"
    });
    expect(steps.entries[0]).toMatchObject({ status: "unknown" });
    expect(steps.entries[0].referenceRange).toBeUndefined();
  });

  it("updates and deletes observations in memory", async () => {
    const source = createDemoDataSource(new Date("2026-07-17T12:00:00.000Z"));
    const before = await source.healthDataDetail("weight");
    const observation = before.entries[0]!;

    await source.updateObservation(observation.id, {
      measurementCode: "weight",
      observedAt: "2026-07-18T09:00:00.000Z",
      value: 72.5,
      unit: "kg",
      note: "Demo adjustment"
    });

    const updated = await source.healthDataDetail("weight");
    expect(updated.entries[0]).toMatchObject({
      id: observation.id,
      value: 72.5,
      note: "Demo adjustment",
      canDelete: true
    });

    await source.deleteObservation(observation.id);
    const deleted = await source.healthDataDetail("weight");
    expect(deleted.entries.find((entry) => entry.id === observation.id)).toBeUndefined();
    expect(deleted.counts.observations).toBe(before.counts.observations - 1);
  });

  it("adds manual observations in memory and refreshes derived totals", async () => {
    const source = createDemoDataSource(new Date("2026-07-17T12:00:00.000Z"));
    const before = await source.healthDataDetail("weight");

    await source.importManualObservations({
      observedAt: "2026-07-18T09:00:00.000Z",
      label: "Manual Weight",
      observations: [{ measurementCode: "weight", value: 72.5, unit: "kg", note: "Demo entry" }]
    });

    const [detail, summary] = await Promise.all([source.healthDataDetail("weight"), source.summary()]);
    expect(detail.entries[0]).toMatchObject({
      value: 72.5,
      unit: "kg",
      note: "Demo entry",
      sourceKind: "manual-entry",
      canDelete: true
    });
    expect(detail.counts.observations).toBe(before.counts.observations + 1);
    expect(summary.totals.observations).toBeGreaterThan(0);
  });

  it("orders dashboard metrics by their latest reading", async () => {
    const source = createDemoDataSource(new Date("2026-07-17T12:00:00.000Z"));

    await source.importManualObservations({
      observedAt: "2026-07-18T09:00:00.000Z",
      label: "Manual Weight",
      observations: [{ measurementCode: "weight", value: 72.5, unit: "kg" }]
    });

    expect((await source.analytics()).latestMetrics[0]).toMatchObject({
      code: "weight",
      value: 72.5,
      observedAt: "2026-07-18T09:00:00.000Z"
    });
  });

  it("supports paginated care reads and demo mutations", async () => {
    const source = createDemoDataSource(new Date("2026-07-17T12:00:00.000Z"));
    const events = await source.listHealthEvents({ limit: 1 });
    const items = await source.listCareItems({ limit: 1, status: "open" });

    expect(events.items).toHaveLength(1);
    expect(events.hasMore).toBe(true);
    expect(items.items[0]?.status).toBe("open");

    await source.createHealthEvent({
      kind: "other",
      status: "completed",
      occurredAt: "2026-07-18T09:00:00.000Z",
      provider: "Demo clinic"
    });
    await source.createCareItem({
      title: "Schedule follow-up",
      kind: "visit",
      priority: "normal",
      status: "open"
    });

    expect((await source.listHealthEvents()).total).toBeGreaterThan(events.total);
    expect((await source.listCareItems()).total).toBeGreaterThanOrEqual(2);
  });

  it("filters both care views by kind and completes an open item atomically", async () => {
    const source = createDemoDataSource(new Date("2026-07-17T12:00:00.000Z"));

    const monitoringItems = await source.listCareItems({ kind: "monitoring" });
    const immunizationEvents = await source.listHealthEvents({ kind: "immunization" });
    const openItem = (await source.listCareItems({ status: "open" })).items[0];

    expect(monitoringItems.items).toHaveLength(1);
    expect(immunizationEvents.items).toHaveLength(1);
    expect(openItem).toBeDefined();

    const completed = await source.completeCareItem(openItem!.id, {
      occurredAt: "2026-07-18T00:00:00.000Z",
      kind: "visit"
    });
    expect(completed.healthEvent).toBeDefined();

    expect(completed.careItem).toMatchObject({
      status: "completed",
      completedAt: "2026-07-18T00:00:00.000Z",
      completedHealthEventId: completed.healthEvent!.id
    });
    expect(completed.healthEvent).toMatchObject({ kind: "visit", status: "completed" });
    expect((await source.listHealthEvents({ kind: "visit" })).items).toContainEqual(completed.healthEvent);
    await expect(source.completeCareItem(openItem!.id, {
      occurredAt: "2026-07-19T00:00:00.000Z",
      kind: "visit"
    })).rejects.toThrow("Only open care items can be completed");

    const monitoring = await source.createCareItem({
      title: "Review blood pressure",
      kind: "monitoring",
      priority: "normal",
      status: "open"
    });
    const eventCount = (await source.listHealthEvents()).total;
    const completedMonitoring = await source.completeCareItem(monitoring.careItem.id, {
      occurredAt: "2026-07-18T00:00:00.000Z"
    });
    expect(completedMonitoring).not.toHaveProperty("healthEvent");
    expect(completedMonitoring.careItem).not.toHaveProperty("completedHealthEventId");
    expect((await source.listHealthEvents()).total).toBe(eventCount);
  });
});