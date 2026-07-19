import { describe, expect, it } from "vitest";
import {
  createCareItemInputSchema,
  createHealthEventInputSchema,
  healthEventSchema
} from "../apiContract.js";
import {
  careItemReminderAt,
  careItemReminderLead,
  careItemKindCodes,
  healthEventKindCodes,
  normalizedCareItemKind
} from "../types.js";

describe("care taxonomies", () => {
  it("accepts every supported health event kind in mutation and response schemas", () => {
    for (const kind of healthEventKindCodes) {
      expect(createHealthEventInputSchema.parse({
        kind,
        status: "completed",
        occurredAt: "2026-07-18T12:00:00.000Z"
      }).kind).toBe(kind);
      expect(healthEventSchema.parse({
        id: `event-${kind}`,
        kind,
        status: "completed",
        occurredAt: "2026-07-18T12:00:00.000Z",
        source: "manual-entry"
      }).kind).toBe(kind);
    }
  });

  it("accepts only stable care item kind codes for mutations", () => {
    for (const kind of careItemKindCodes) {
      expect(createCareItemInputSchema.parse({
        title: "Care task",
        kind,
        priority: "normal",
        status: "open"
      }).kind).toBe(kind);
    }
    expect(createCareItemInputSchema.safeParse({
      title: "Care task",
      kind: "Appointment",
      priority: "normal",
      status: "open"
    }).success).toBe(false);
  });

  it("maps common legacy care item values to the closest stable kind", () => {
    expect(normalizedCareItemKind("Follow-up")).toBe("follow-up");
    expect(normalizedCareItemKind("Appointment")).toBe("routine-checkup");
    expect(normalizedCareItemKind("Custom legacy value")).toBe("other");
  });

  it("converts reminder lead choices to concrete timestamps based on due start", () => {
    const dueStart = new Date(2026, 2, 31, 12, 0, 0).toISOString();
    const oneDay = careItemReminderAt(dueStart, "one-day");
    const oneWeek = careItemReminderAt(dueStart, "one-week");
    const oneMonth = careItemReminderAt(dueStart, "one-month");

    expect(oneDay).toBe(new Date(2026, 2, 30, 12, 0, 0).toISOString());
    expect(oneWeek).toBe(new Date(2026, 2, 24, 12, 0, 0).toISOString());
    expect(oneMonth).toBe(new Date(2026, 1, 28, 12, 0, 0).toISOString());
    expect(careItemReminderLead(dueStart, oneWeek)).toBe("one-week");
    expect(createCareItemInputSchema.safeParse({
      title: "Care task",
      kind: "follow-up",
      dueEnd: dueStart,
      reminderAt: oneWeek,
      priority: "normal",
      status: "open"
    }).success).toBe(false);
  });
});
