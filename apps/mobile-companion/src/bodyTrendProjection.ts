import {
  defaultMeasurementTypes,
  toPreferredMeasurementValue,
  type BodyTrendPoint,
  type BodyTrendQuery,
  type BodyTrendTimeline,
  type Profile
} from "@vitana/shared";

export const BODY_TREND_CODES = [
  "skeletal_muscle_mass",
  "fat_mass",
  "bone_mineral_content",
  "weight"
] as const;

const REQUIRED_CODES = BODY_TREND_CODES.slice(0, 3);
const MAX_POINTS = 500;

export interface BodyTrendObservation {
  id: string;
  measurementCode: string;
  observedAt: string;
  value: number;
  unit: string;
  observationGroupId?: string;
  sourceLabel?: string;
}

export function bodyTrendFromObservations(
  query: BodyTrendQuery,
  observations: BodyTrendObservation[],
  units: Profile["units"],
  now = new Date()
): BodyTrendTimeline {
  const registry = new Map(defaultMeasurementTypes.map((type) => [type.code, type]));
  const massType = registry.get("weight");
  const groups = new Map<string, BodyTrendObservation[]>();
  const cutoff = rangeCutoff(query.range, now);

  for (const observation of observations) {
    if (!BODY_TREND_CODES.includes(observation.measurementCode as typeof BODY_TREND_CODES[number])) continue;
    if (cutoff && observation.observedAt < cutoff) continue;
    const sessionId = observation.observationGroupId
      ?? `ungrouped:${observation.sourceLabel ?? "unknown"}:${observation.observedAt}`;
    const group = groups.get(sessionId) ?? [];
    group.push(observation);
    groups.set(sessionId, group);
  }

  const daily = new Map<string, BodyTrendPoint>();
  for (const [sessionId, group] of groups) {
    const latestByCode = new Map<string, BodyTrendObservation>();
    for (const observation of group) {
      const existing = latestByCode.get(observation.measurementCode);
      if (!existing || observation.observedAt > existing.observedAt
        || (observation.observedAt === existing.observedAt && observation.id > existing.id)) {
        latestByCode.set(observation.measurementCode, observation);
      }
    }
    if (!REQUIRED_CODES.every((code) => latestByCode.has(code))) continue;

    const converted = (code: string) => {
      const observation = latestByCode.get(code)!;
      const type = registry.get(code) ?? massType;
      return type ? toPreferredMeasurementValue(observation.value, observation.unit, type, units) : observation;
    };
    const muscle = converted("skeletal_muscle_mass");
    const fat = converted("fat_mass");
    const bone = converted("bone_mineral_content");
    const weight = latestByCode.has("weight") ? converted("weight") : undefined;
    const observedAt = [...latestByCode.values()]
      .map((observation) => observation.observedAt)
      .sort()
      .at(-1)!;
    const date = localDate(observedAt, query.timezone);
    const sourceLabel = [...latestByCode.values()].reverse().find((observation) => observation.sourceLabel)?.sourceLabel;
    const point: BodyTrendPoint = {
      sessionId,
      date,
      observedAt,
      ...(sourceLabel ? { sourceLabel } : {}),
      components: {
        skeletalMuscleMass: muscle.value,
        fatMass: fat.value,
        boneMineralContent: bone.value,
        ...(weight ? { weight: weight.value } : {})
      }
    };
    const existing = daily.get(date);
    if (!existing || point.observedAt > existing.observedAt
      || (point.observedAt === existing.observedAt && point.sessionId > existing.sessionId)) {
      daily.set(date, point);
    }
  }

  const allPoints = [...daily.values()].sort((left, right) => left.date.localeCompare(right.date));
  const points = allPoints.slice(-MAX_POINTS);
  return {
    generatedAt: now.toISOString(),
    range: query.range,
    timezone: query.timezone,
    unit: massType
      ? toPreferredMeasurementValue(1, "kg", massType, units).unit
      : units === "imperial" ? "lb" : "kg",
    points,
    totalPoints: allPoints.length,
    truncated: allPoints.length > points.length
  };
}

function localDate(timestamp: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(timestamp));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function rangeCutoff(range: BodyTrendQuery["range"], now: Date) {
  if (range === "all") return undefined;
  const cutoff = new Date(now);
  if (range === "1m") cutoff.setUTCMonth(cutoff.getUTCMonth() - 1);
  if (range === "3m") cutoff.setUTCMonth(cutoff.getUTCMonth() - 3);
  if (range === "1y") cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  return cutoff.toISOString();
}