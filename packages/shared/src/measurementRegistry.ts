import type {
  MeasurementType,
  PersonalReferenceRange,
  ReferenceRange,
  ReferenceRangeState,
  SubjectKind,
  UnitSystem
} from "./types.js";
import { defaultMeasurementTypes } from "./registry.js";

export function findMeasurementType(input: string, registry = defaultMeasurementTypes): MeasurementType | undefined {
  const normalized = normalizeMeasurementLookup(input);
  return registry.find((type) => {
    if (normalizeMeasurementLookup(type.code) === normalized) {
      return true;
    }
    return type.aliases.some((alias) => normalizeMeasurementLookup(alias) === normalized);
  });
}

function normalizeMeasurementLookup(value: string): string {
  return value.trim().toLowerCase()
    .replaceAll("_", " ")
    .replace(/[()[\]{}#*†‡]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyValue(
  value: number,
  type: MeasurementType,
  unitOrLow: string | number = type.canonicalUnit,
  legacyHigh?: number
): "low" | "normal" | "high" | "unknown" {
  if (typeof unitOrLow === "number") {
    if (value < unitOrLow) return "low";
    if (legacyHigh !== undefined && value > legacyHigh) return "high";
    return "normal";
  }
  const range = getReferenceRange(type, unitOrLow);
  if (!range) {
    return "unknown";
  }
  const { low, high } = range;
  if (Number.isFinite(low) && value < Number(low)) {
    return "low";
  }
  if (Number.isFinite(high) && value > Number(high)) {
    return "high";
  }
  if (Number.isFinite(low) || Number.isFinite(high)) {
    return "normal";
  }
  return "unknown";
}

export function getPreferredUnit(type: MeasurementType, units: UnitSystem): string {
  return type.preferredUnits?.[units] ?? type.canonicalUnit;
}

export function convertMeasurementValue(
  value: number,
  type: MeasurementType,
  fromUnit: string,
  toUnit: string
): number | undefined {
  const from = normalizeMeasurementUnit(type, fromUnit);
  const to = normalizeMeasurementUnit(type, toUnit);
  if (from === to) return value;
  const factor = conversionFactor(type.code, from, to);
  return factor ? factor(value) : undefined;
}

export function toPreferredMeasurementValue(
  value: number,
  unit: string,
  type: MeasurementType,
  units: UnitSystem
): { value: number; unit: string } {
  const preferredUnit = getPreferredUnit(type, units);
  const converted = convertMeasurementValue(value, type, unit, preferredUnit);
  return converted === undefined ? { value, unit } : { value: converted, unit: preferredUnit };
}

export function getReferenceRange(type: MeasurementType, unit: string): ReferenceRange | undefined {
  const normalizedUnit = normalizeMeasurementUnit(type, unit);
  const direct = type.referenceRanges?.find((candidate) => normalizeMeasurementUnit(type, candidate.unit) === normalizedUnit);
  if (direct) return direct;
  const source = type.referenceRanges?.find((candidate) => candidate.unit === type.canonicalUnit);
  if (!source) return undefined;
  const low = source.low === undefined ? undefined : convertMeasurementValue(source.low, type, source.unit, unit);
  const high = source.high === undefined ? undefined : convertMeasurementValue(source.high, type, source.unit, unit);
  if ((source.low !== undefined && low === undefined) || (source.high !== undefined && high === undefined)) {
    return undefined;
  }
  return { ...source, ...(low === undefined ? {} : { low }), ...(high === undefined ? {} : { high }), unit };
}

export function resolveReferenceRange(
  type: MeasurementType,
  unit: string,
  personal: PersonalReferenceRange | undefined,
  subjectKind: SubjectKind = "adult"
): ReferenceRangeState {
  const catalog = subjectKind === "adult" ? getReferenceRange(type, unit) : undefined;
  if (!personal) {
    return catalog ? { catalog, effective: catalog, source: "catalog" } : { source: "none" };
  }
  const low = personal.normalLow === undefined
    ? undefined
    : convertMeasurementValue(personal.normalLow, type, personal.unit, unit);
  const high = personal.normalHigh === undefined
    ? undefined
    : convertMeasurementValue(personal.normalHigh, type, personal.unit, unit);
  if ((personal.normalLow !== undefined && low === undefined) || (personal.normalHigh !== undefined && high === undefined)) {
    return { ...(catalog ? { catalog } : {}), source: "none" };
  }
  const optimalLow = personal.optimalLow === undefined
    ? undefined
    : convertMeasurementValue(personal.optimalLow, type, personal.unit, unit);
  const optimalHigh = personal.optimalHigh === undefined
    ? undefined
    : convertMeasurementValue(personal.optimalHigh, type, personal.unit, unit);
  const normalRange = {
    ...(low === undefined ? {} : { low }),
    ...(high === undefined ? {} : { high }),
    unit
  };
  if (low === undefined && high === undefined) {
    return { ...(catalog ? { catalog } : {}), source: "none" };
  }
  const optimal = optimalLow === undefined || optimalHigh === undefined
    ? undefined
    : { low: optimalLow, high: optimalHigh, unit };
  return {
    personal: normalRange,
    ...(catalog ? { catalog } : {}),
    effective: normalRange,
    ...(optimal ? { optimal } : {}),
    source: "personal"
  };
}

export function classifyValueWithRange(
  value: number,
  range: ReferenceRange | undefined
): "low" | "normal" | "high" | "unknown" {
  if (!range) return "unknown";
  if (range.low !== undefined && value < range.low) return "low";
  if (range.high !== undefined && value > range.high) return "high";
  return range.low !== undefined || range.high !== undefined ? "normal" : "unknown";
}

export function normalizeMeasurementUnit(type: MeasurementType, unit: string): string {
  const normalized = unit.trim().toLowerCase().replaceAll("μ", "µ").replaceAll(" ", "");
  for (const [canonical, aliases] of Object.entries(type.unitAliases ?? {})) {
    if ([canonical, ...aliases].some((candidate) => candidate.toLowerCase().replaceAll("μ", "µ").replaceAll(" ", "") === normalized)) {
      return canonical.toLowerCase().replaceAll("μ", "µ").replaceAll(" ", "");
    }
  }
  return normalized;
}

export type MeasurementRejectionReason = "invalid-value" | "unconvertible-unit";

export type CanonicalMeasurement =
  | { rejected: false; value: number; unit: string; sourceUnit?: string }
  | { rejected: true; reason: MeasurementRejectionReason; code: string; unit: string };

/**
 * Normalizes a measurement onto its registry canonical unit before it reaches storage.
 *
 * Codes that resolve to a measurement type must be convertible - an unconvertible unit rejects
 * that single row rather than silently persisting a value in unknown units. Codes with no type
 * (the manual_* and body_comp_* codes minted by custom entry) are stored verbatim, because there
 * is no canonical unit to normalize onto.
 */
export function canonicalizeMeasurement(
  code: string,
  value: number,
  unit: string,
  registry = defaultMeasurementTypes
): CanonicalMeasurement {
  if (!Number.isFinite(value)) {
    return { rejected: true, reason: "invalid-value", code, unit };
  }
  const type = findMeasurementType(code, registry);
  if (!type) {
    return { rejected: false, value, unit };
  }
  const converted = convertMeasurementValue(value, type, unit, type.canonicalUnit);
  if (converted === undefined || !Number.isFinite(converted)) {
    return { rejected: true, reason: "unconvertible-unit", code, unit };
  }
  const alreadyCanonical = normalizeMeasurementUnit(type, unit) === normalizeMeasurementUnit(type, type.canonicalUnit);
  return alreadyCanonical
    ? { rejected: false, value: converted, unit: type.canonicalUnit }
    : { rejected: false, value: converted, unit: type.canonicalUnit, sourceUnit: unit };
}

export function describeMeasurementRejection(rejection: Extract<CanonicalMeasurement, { rejected: true }>): string {
  return rejection.reason === "invalid-value"
    ? `${rejection.code}: value is not a finite number`
    : `${rejection.code}: unit "${rejection.unit}" cannot be converted to the canonical unit`;
}

function conversionFactor(code: string, from: string, to: string): ((value: number) => number) | undefined {
  const reciprocal = (factor: number) => (value: number) => value * factor;
  if (from === "kg" && to === "lb") return reciprocal(2.2046226218);
  if (from === "lb" && to === "kg") return reciprocal(1 / 2.2046226218);
  if (from === "cm" && to === "in") return reciprocal(1 / 2.54);
  if (from === "in" && to === "cm") return reciprocal(2.54);
  if (from === "l" && to === "floz") return reciprocal(33.8140227);
  if (from === "floz" && to === "l") return reciprocal(1 / 33.8140227);
  if (from === "°c" && to === "°f") return (value) => value * 9 / 5 + 32;
  if (from === "°f" && to === "°c") return (value) => (value - 32) * 5 / 9;
  const microMolesPerDecilitre = microMolesPerMgDl(code);
  if (microMolesPerDecilitre && from === "µmol/l" && to === "mg/dl") return reciprocal(1 / microMolesPerDecilitre);
  if (microMolesPerDecilitre && from === "mg/dl" && to === "µmol/l") return reciprocal(microMolesPerDecilitre);
  const millimolesPerDecilitre = mgPerDlFactor(code);
  if (millimolesPerDecilitre && from === "mmol/l" && to === "mg/dl") {
    return reciprocal(millimolesPerDecilitre);
  }
  if (millimolesPerDecilitre && from === "mg/dl" && to === "mmol/l") {
    return reciprocal(1 / millimolesPerDecilitre);
  }
  if (code === "hba1c" && from === "mmol/mol" && to === "%") return (value) => value * 0.09148 + 2.152;
  if (code === "hba1c" && from === "%" && to === "mmol/mol") return (value) => (value - 2.152) / 0.09148;
  if (bodyWaterCodes.has(code) && from === "kg" && to === "l") return reciprocal(1);
  if (bodyWaterCodes.has(code) && from === "l" && to === "kg") return reciprocal(1);
  // Decilitre/litre and SI prefix steps are pure dimensional scaling, so they apply to every
  // analyte rather than being special-cased per code.
  const decilitre = decilitreFactor(from, to);
  if (decilitre) return decilitre;
  if (from === "nmol/l" && to === "µmol/l") return reciprocal(0.001);
  if (from === "µmol/l" && to === "nmol/l") return reciprocal(1000);
  if (from === "pmol/l" && to === "nmol/l") return reciprocal(0.001);
  if (from === "nmol/l" && to === "pmol/l") return reciprocal(1000);
  if (from === "l/l" && to === "%") return reciprocal(100);
  if (from === "%" && to === "l/l") return reciprocal(0.01);
  if (from === "min" && to === "sec") return reciprocal(60);
  if (from === "sec" && to === "min") return reciprocal(1 / 60);
  if (from === "g" && to === "kg") return reciprocal(0.001);
  if (from === "kg" && to === "g") return reciprocal(1000);
  return undefined;
}

/** Water density is 1 kg/L, so body-water volumes and masses are interchangeable. */
const bodyWaterCodes = new Set(["total_body_water", "intracellular_water", "extracellular_water"]);

function decilitreFactor(from: string, to: string): ((value: number) => number) | undefined {
  for (const prefix of ["g", "mg", "µg", "ng"]) {
    if (from === `${prefix}/l` && to === `${prefix}/dl`) return (value) => value * 0.1;
    if (from === `${prefix}/dl` && to === `${prefix}/l`) return (value) => value * 10;
  }
  return undefined;
}

function microMolesPerMgDl(code: string): number | undefined {
  if (code === "creatinine") return 88.4;
  if (code === "uric_acid") return 59.48;
  return undefined;
}

function mgPerDlFactor(code: string): number | undefined {
  if (code === "glucose") return 18.0182;
  if (code === "calcium") return 4.0;
  if (code === "urea") return 2.8;
  if (code === "triglycerides") return 88.57;
  if (code === "total_cholesterol" || code === "non_hdl_cholesterol" || code === "hdl_cholesterol" || code === "ldl_cholesterol") return 38.67;
  return undefined;
}
