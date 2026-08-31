import { describe, expect, it } from "vitest";
import { medicationDateStatus, medicationMatchesStatus } from "../medicationStatus.js";

const today = "2026-08-30";

describe("medicationDateStatus", () => {
  it("treats missing date boundaries as active", () => {
    expect(medicationDateStatus({}, today)).toBe("active");
    expect(medicationDateStatus({ startDate: "2026-09-10" }, today)).toBe("active");
    expect(medicationDateStatus({ endDate: "2026-09-10" }, today)).toBe("active");
  });

  it("keeps fully dated ranges active through the end date", () => {
    expect(medicationDateStatus({ startDate: "2026-08-01", endDate: today }, today)).toBe("active");
    expect(medicationDateStatus({ startDate: today, endDate: "2026-09-30" }, today)).toBe("active");
  });

  it("gives an elapsed end date precedence over a missing start date", () => {
    const medication = { endDate: "2026-08-29" };
    expect(medicationDateStatus(medication, today)).toBe("past");
    expect(medicationMatchesStatus(medication, "active", today)).toBe(false);
    expect(medicationMatchesStatus(medication, "past", today)).toBe(true);
  });

  it("keeps fully dated future records out of Active and Past", () => {
    const medication = { startDate: "2026-09-01", endDate: "2026-09-30" };
    expect(medicationDateStatus(medication, today)).toBe("future");
    expect(medicationMatchesStatus(medication, "active", today)).toBe(false);
    expect(medicationMatchesStatus(medication, "past", today)).toBe(false);
  });
});
