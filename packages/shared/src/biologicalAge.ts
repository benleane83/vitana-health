import type {
  BiologicalAgeInput,
  BiologicalAgeModelResult,
  BiologicalAgeReport,
  Observation,
  Profile
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

export const biologicalAgeMeasurementCodes = phenoAgeInputs.map(([code]) => code);

export interface BiologicalAgeSource {
  profile: Pick<Profile, "subjectKind" | "birthDate">;
  observations: Observation[];
}

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
  "Liu Z et al. A new aging measure captures morbidity and mortality risk across diverse subpopulations. PLOS Medicine. 2018;15(12):e1002718.";

const disclaimer =
  "This is an informational wellness estimate, not medical advice, a diagnosis, a prognosis, or a prediction of lifespan. Results depend on complete, accurate lab data and can be affected by temporary health factors, laboratory methods, and collection dates. Discuss any concerns with a qualified doctor.";

export function calculateBiologicalAge(store: BiologicalAgeSource, generatedAt = new Date().toISOString()): BiologicalAgeReport {
  if (store.profile.subjectKind && store.profile.subjectKind !== "adult") {
    return {
      generatedAt,
      disclaimer,
      models: [{
        ...calculatePhenoAge(store, generatedAt),
        status: "incomplete",
        chronologicalAge: undefined,
        chronologicalAgeDetail: "Biological age estimates are available only for adult profiles.",
        biologicalAge: undefined,
        ageAcceleration: undefined,
        calculatedAt: undefined
      }]
    };
  }
  return {
    generatedAt,
    disclaimer,
    models: [calculatePhenoAge(store, generatedAt)]
  };
}

function calculatePhenoAge(store: BiologicalAgeSource, generatedAt: string): BiologicalAgeModelResult {
  const observations = Array.isArray(store.observations) ? store.observations : [];
  const candidate = latestInputs(observations);
  const birthDate = store.profile?.birthDate;
  const chronologicalAge = birthDate ? ageForBirthDate(birthDate, candidate?.collectedAt ?? generatedAt) : undefined;

  const base: Omit<BiologicalAgeModelResult, "status" | "biologicalAge" | "ageAcceleration" | "calculatedAt"> = {
    id: "phenoage-levine-2018",
    name: "PhenoAge",
    version: "Levine 2018",
    methodology: "A published wellness measure that combines chronological age with nine routine blood markers.",
    citation: phenoAgeCitation,
    chronologicalAge,
    chronologicalAgeDetail: chronologicalAge === undefined
      ? "Add a valid birth date to calculate chronological age."
      : "Calculated from the stored birth date at the selected panel date.",
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

function ageForBirthDate(birthDate: string, date: string): number | undefined {
  const birth = new Date(`${birthDate}T00:00:00.000Z`);
  const reference = new Date(date);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(reference.getTime()) || birth > reference) return undefined;
  const age = (reference.getTime() - birth.getTime()) / (365.2425 * 24 * 60 * 60 * 1000);
  if (!Number.isFinite(age) || age < 18 || age > 120) return undefined;
  return Math.round(age * 10) / 10;
}
