import { localCalendarDate } from "./dateFormatting.js";
import type { Medication } from "./types.js";

export type MedicationStatusFilter = "active" | "past";
export type MedicationDateStatus = MedicationStatusFilter | "future";

export function medicationDateStatus(
  medication: Pick<Medication, "startDate" | "endDate">,
  today = localCalendarDate(new Date())
): MedicationDateStatus {
  if (medication.endDate && medication.endDate < today) return "past";
  if (!medication.startDate || !medication.endDate) return "active";
  return medication.startDate <= today ? "active" : "future";
}

export function medicationMatchesStatus(
  medication: Pick<Medication, "startDate" | "endDate">,
  status?: MedicationStatusFilter,
  today?: string
): boolean {
  return !status || medicationDateStatus(medication, today) === status;
}
