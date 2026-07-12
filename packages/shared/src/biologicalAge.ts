import type {
  BiologicalAgeInput,
  BiologicalAgeModelResult,
  BiologicalAgeReport,
  HealthStoreData,
  Observation
} from "./types.js";

const phenoAgeInputs = [
  ["albumin", "Albumin", "g/L"],
  ["creatinine", "Creatinine", "µmol/L"],
  ["glucose", "Glucose", "mmol/L"],
  ["high_sensitivity_c_reactive_protein", "C-reactive protein", "mg/dL (ln transformed)"],
  ["lymphocyte_percentage", "Lymphocyte percentage", "%"],
  ["mean_corpuscular_volume", "Mean corpuscular volume", "fL"],
  ["red_cell_distribution_width", "Red cell distribution width", "%"],
  ["alkaline_phosphatase", "Alkaline phosphatase", "U/L"],
  ["white_blood_cell_count", "White blood cell count", "10³/µL"]
] as const;

type PhenoAgeCode = (typeof phenoAgeInputs)[number][0];

const plausibleRanges: Record<PhenoAgeCode, readonly [number, number]> = {
  albumin: [10, 70],
  creatinine: [10, 1_500],
  glucose: [1, 40],
  high_sensitivity_c_reactive_protein: [0.001, 100],
  lymphocyte_percentage: [1, 99],
  mean_corpuscular_volume: [40, 150],
  red_cell_distribution_width: [5, 40],
  alkaline_phosphatase: [1, 2_000],
  white_blood_cell_count: [0.1, 200]
};

const phenoAgeCitation =
  "Levine ME et al. An epigenetic biomarker of aging for lifespan and healthspan. Aging. 2018;10(4):573-591. doi:10.18632/aging.101414.";

const disclaimer =
  "This wellness estimate is not a diagnosis, prognosis, or medical advice. Results depend on laboratory methods and complete, contemporaneous inputs; discuss questions or concerning results with a qualified clinician.";

export function calculateBiologicalAge(store: HealthStoreData, generatedAt = new Date().toISOString()): BiologicalAgeReport {
  return {
    generatedAt,
    disclaimer,
    models: [calculatePhenoAge(store, generatedAt)]
  };
}

function calculatePhenoAge(store: HealthStoreData, generatedAt: string): BiologicalAgeModelResult {
  const observations = Array.isArray(store.observations) ? store.observations : [];
  const candidate = latestInputs(observations);
  const birthYear = typeof store.profile?.birthYear === "number" ? store.profile.birthYear : undefined;
  const chronologicalAge = ageForDate(birthYear, candidate?.collectedAt ?? generatedAt);

  const base: Omit<BiologicalAgeModelResult, "status" | "biologicalAge" | "ageAcceleration" | "calculatedAt"> = {
    id: "phenoage-levine-2018",
    name: "PhenoAge",
    version: "Levine 2018",
    methodology: "Published mortality-score transformation using chronological age and nine laboratory biomarkers.",
    citation: phenoAgeCitation,
    chronologicalAge,
    chronologicalAgeDetail: chronologicalAge === undefined
      ? "Add a valid birth year to calculate chronological age."
      : "Estimated from the stored birth year at the selected panel date.",
    panelCollectedAt: candidate?.collectedAt,
    inputs: candidate?.inputs ?? emptyInputs(),
    limitations: [
      "Each biomarker uses the most recent valid value found in local lab observations.",
      "Inputs can originate from different collection dates and panels.",
      "No missing biomarkers are imputed.",
      "The published model was developed with the units shown for each input."
    ]
  };

  if (!candidate || chronologicalAge === undefined || candidate.inputs.some((input) => input.status !== "used")) {
    return { ...base, status: "incomplete" };
  }

  const values = Object.fromEntries(candidate.inputs.map((input) => [input.code, input.normalizedValue])) as Record<PhenoAgeCode, number>;
  const linearPredictor =
    -19.90667 +
    0.08035356 * chronologicalAge -
    0.03359355 * values.albumin +
    0.009506491 * values.creatinine +
    0.1953192 * values.glucose +
    0.09536762 * Math.log(values.high_sensitivity_c_reactive_protein) -
    0.01199984 * values.lymphocyte_percentage +
    0.02676401 * values.mean_corpuscular_volume +
    0.3306156 * values.red_cell_distribution_width +
    0.001868778 * values.alkaline_phosphatase +
    0.05542406 * values.white_blood_cell_count;
  // Algebraically equivalent to the published Gompertz mortality-score transformation,
  // but avoids loss of precision when an extreme score rounds to 1.
  const biologicalAge =
    141.50225 +
    (Math.log(0.00553 * (Math.exp(0.0076927 * 120) - 1) / 0.0076927) + linearPredictor) / 0.090165;

  return {
    ...base,
    status: "available",
    biologicalAge,
    ageAcceleration: biologicalAge - chronologicalAge,
    calculatedAt: generatedAt
  };
}

function latestInputs(observations: Observation[]) {
  const inputs = phenoAgeInputs.map(([code, label, normalizedUnit]) => {
    const observation = [...observations]
      .filter((entry) => entry.measurementCode === code)
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
    return inputFromObservation(code, label, normalizedUnit, observation);
  });
  const collectedAt = inputs
    .filter((input) => input.status === "used" && input.observedAt)
    .map((input) => input.observedAt as string)
    .sort()
    .at(-1);
  return { collectedAt, inputs };
}

function emptyInputs(): BiologicalAgeInput[] {
  return phenoAgeInputs.map(([code, label, normalizedUnit]) => ({
    code,
    label,
    normalizedUnit,
    status: "missing" as const,
    detail: "No lab panel is available."
  }));
}

function inputFromObservation(
  code: PhenoAgeCode,
  label: string,
  normalizedUnit: string,
  observation: Observation | undefined
): BiologicalAgeInput {
  if (!observation) return { code, label, normalizedUnit, status: "missing", detail: "Not found in local observations." };
  const normalizedValue = normalizeValue(code, observation.value, observation.unit);
  if (normalizedValue === undefined) {
    return {
      code, label, value: observation.value, unit: observation.unit, normalizedUnit, observedAt: observation.observedAt,
      status: "invalid", detail: `Unsupported unit "${observation.unit}" or invalid value.`
    };
  }
  const [minimum, maximum] = plausibleRanges[code];
  if (normalizedValue < minimum || normalizedValue > maximum) {
    return {
      code, label, value: observation.value, unit: observation.unit, normalizedUnit, observedAt: observation.observedAt,
      status: "invalid", detail: `Value is outside the supported ${minimum}-${maximum} ${normalizedUnit} range; check the value and unit.`
    };
  }
  return {
    code, label, value: observation.value, unit: observation.unit, normalizedValue, normalizedUnit,
    observedAt: observation.observedAt, status: "used"
  };
}

function normalizeValue(code: PhenoAgeCode, value: number, unit: string): number | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const normalized = unit.trim().toLowerCase().replace(/\s/g, "").replace("μ", "µ");
  const directUnits: Partial<Record<PhenoAgeCode, string[]>> = {
    albumin: ["g/l"],
    creatinine: ["µmol/l"],
    glucose: ["mmol/l"],
    high_sensitivity_c_reactive_protein: ["mg/dl"],
    lymphocyte_percentage: ["%"],
    mean_corpuscular_volume: ["fl"],
    red_cell_distribution_width: ["%"],
    alkaline_phosphatase: ["u/l", "iu/l"],
    white_blood_cell_count: ["10³/µl", "10^3/µl", "x10^3/µl", "10^9/l", "×10⁹/l", "x10⁹/l"]
  };
  if (directUnits[code]?.includes(normalized)) return value;
  if (code === "albumin" && normalized === "g/dl") return value * 10;
  if (code === "creatinine" && normalized === "mg/dl") return value * 88.4017;
  if (code === "glucose" && normalized === "mg/dl") return value / 18.0182;
  if (code === "high_sensitivity_c_reactive_protein" && normalized === "mg/l") return value / 10;
  return undefined;
}

function ageForDate(birthYear: number | undefined, date: string): number | undefined {
  if (!birthYear || !Number.isInteger(birthYear)) return undefined;
  const year = new Date(date).getUTCFullYear();
  const age = year - birthYear;
  return Number.isFinite(age) && age >= 18 && age <= 120 ? age : undefined;
}
