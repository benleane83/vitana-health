import type { HealthStoreData } from "@local-fitness-advisor/shared";

export interface StoreAnswerPlan {
  answerLead: string;
  rows: Array<Record<string, unknown>>;
}

export function planStoreAnswer(question: string, store: HealthStoreData): StoreAnswerPlan | undefined {
  const q = question.trim().toLowerCase();

  if (includesAny(q, ["last", "latest", "most recent"]) && includesAny(q, ["heart rate", "hr"])) {
    const row = latestMeasurementRow(store, "heart_rate");
    return {
      answerLead: "Latest heart-rate reading",
      rows: row ? [row] : []
    };
  }

  if (includesAny(q, ["last", "latest", "most recent"]) && includesAny(q, ["oxygen", "spo2", "saturation"])) {
    const row = latestMeasurementRow(store, "oxygen_saturation");
    return {
      answerLead: "Latest oxygen saturation reading",
      rows: row ? [row] : []
    };
  }

  return undefined;
}

function latestMeasurementRow(store: HealthStoreData, measurementCode: string): Record<string, unknown> | undefined {
  const observationRows = store.observations
    .filter((entry) => entry.measurementCode === measurementCode)
    .map((entry) => ({
      recorded_at: entry.observedAt,
      value: entry.value,
      unit: entry.unit,
      source: "observations"
    }));

  const sampleRows = store.timeSeriesSamples
    .filter((entry) => entry.measurementCode === measurementCode)
    .map((entry) => ({
      recorded_at: entry.startAt,
      value: entry.value,
      unit: entry.unit,
      source: "timeSeriesSamples"
    }));

  const merged = [...observationRows, ...sampleRows]
    .sort((a, b) => String(b.recorded_at).localeCompare(String(a.recorded_at)));

  return merged[0];
}

function includesAny(input: string, terms: string[]): boolean {
  return terms.some((term) => input.includes(term));
}
