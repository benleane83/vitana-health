import { describe, expect, it } from "vitest";
import {
  careItemListQuerySchema,
  completeCareItemInputSchema,
  createCareItemInputSchema,
  createHealthEventInputSchema,
  healthEventSchema
} from "../apiContract.js";
import {
  careItemReminderAt,
  careItemReminderLead,
  careItemKindCodes,
  defaultHealthEventKindForCareItem,
  healthEventKindConcepts,
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

  it("defines each health event kind as a coded concept with a FHIR resource mapping", () => {
    expect(healthEventKindConcepts).toEqual([
      { code: "visit", display: "Visit or consultation", fhirCode: "Encounter" },
      { code: "condition", display: "Condition or diagnosis", fhirCode: "Condition" },
      { code: "symptom", display: "Symptom or concern", fhirCode: "Condition" },
      { code: "procedure", display: "Procedure or surgery", fhirCode: "Procedure" },
      { code: "medication", display: "Medication", fhirCode: "MedicationStatement" },
      { code: "immunization", display: "Immunization", fhirCode: "Immunization" },
      { code: "allergy-intolerance", display: "Allergy or intolerance", fhirCode: "AllergyIntolerance" },
      { code: "other", display: "Other health event", fhirCode: "Basic" }
    ]);
    expect(healthEventKindCodes).not.toContain("treatment");
    expect(healthEventKindCodes).not.toContain("dental");
    expect(healthEventKindCodes).not.toContain("test");
    expect(healthEventKindCodes).not.toContain("injury");
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
    expect(normalizedCareItemKind("Follow-up")).toBe("visit");
    expect(normalizedCareItemKind("Appointment")).toBe("visit");
    expect(normalizedCareItemKind("Test screening")).toBe("procedure");
    expect(normalizedCareItemKind("Custom legacy value")).toBe("other");
  });

  it("converts reminder lead choices to concrete timestamps based on due start", () => {
    const dueStart = new Date(2026, 2, 31, 12, 0, 0).toISOString();
    const oneDay = careItemReminderAt(dueStart, "one-day");
    const oneWeek = careItemReminderAt(dueStart, "one-week");

    expect(oneDay).toBe(new Date(2026, 2, 30, 12, 0, 0).toISOString());
    expect(oneWeek).toBe(new Date(2026, 2, 24, 12, 0, 0).toISOString());
    expect(careItemReminderLead(dueStart, oneWeek)).toBe("one-week");
  });

  it("accepts independent reminder dates and care item kind filters", () => {
    expect(createCareItemInputSchema.parse({
      title: "Care task",
      kind: "visit",
      reminderAt: "2026-08-20T12:00:00.000Z",
      priority: "normal",
      status: "open"
    }).reminderAt).toBe("2026-08-20T12:00:00.000Z");
    expect(careItemListQuerySchema.parse({ kind: "procedure" }).kind).toBe("procedure");
  });

  it("maps care kinds to completion event defaults and validates completion input", () => {
    expect(defaultHealthEventKindForCareItem.visit).toBe("visit");
    expect(defaultHealthEventKindForCareItem.procedure).toBe("procedure");
    expect(defaultHealthEventKindForCareItem.medication).toBe("medication");
    expect(defaultHealthEventKindForCareItem.monitoring).toBeUndefined();
    expect(completeCareItemInputSchema.parse({
      occurredAt: "2026-08-20T12:00:00.000Z",
      kind: "visit"
    })).toEqual({ occurredAt: "2026-08-20T12:00:00.000Z", kind: "visit" });
    expect(completeCareItemInputSchema.parse({
      occurredAt: "2026-08-20T12:00:00.000Z"
    })).toEqual({ occurredAt: "2026-08-20T12:00:00.000Z" });
  });
});
