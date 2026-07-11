import type {
  BiologicalAgeInput,
  BiologicalAgeModelResult,
  BiologicalAgeReport,
  HealthStoreData,
  Observation,
  ObservationGroup
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

const phenoAgeCitation =
  "Levine ME et al. An epigenetic biomarker of aging for lifespan and healthspan. Aging. 2018;10(4):573-591. doi:10.18632/aging.101414.";

const disclaimer =
  "This wellness estimate is not a diagnosis, prognosis, or medical advice. Results depend on laboratory methods and complete, contemporaneous inputs; discuss questions or concerning results with a qualified clinician.";

export function calculateBiologicalAge(store: HealthStoreData, generatedAt = new Date().toISOString()): BiologicalAgeReport {
  return {
    generatedAt,
    disclaimer,
    models: [calculatePhenoAge(store, generatedAt), unavailableBortzAge()]
  };
}

function calculatePhenoAge(store: HealthStoreData, generatedAt: string): BiologicalAgeModelResult {
  const groups = store.observationGroups
    .filter((group) => group.kind === "lab_panel")
    .sort((a, b) => groupDate(b, store.observations).localeCompare(groupDate(a, store.observations)));
  const candidates = groups.map((group) => panelInputs(group, store.observations));
  const candidate = candidates.find((item) => item.inputs.every((input) => input.status === "used")) ?? candidates[0];
  const chronologicalAge = ageForDate(store.profile.birthYear, candidate?.collectedAt ?? generatedAt);

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
      "Only a complete single lab panel is scored; values from separate panels are not combined.",
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

function unavailableBortzAge(): BiologicalAgeModelResult {
  return {
    id: "bortz-age-2023",
    name: "Bortz Age",
    version: "Bortz et al. 2023",
    status: "not-implemented",
    methodology: "Not calculated until the published 22-feature mapping and implementation inputs are fully validated.",
    citation: "Bortz DM et al. 2023 biological-age model.",
    inputs: [],
    limitations: ["This model is intentionally unavailable in this release to avoid reporting an unvalidated implementation."]
  };
}

function panelInputs(group: ObservationGroup, observations: Observation[]) {
  const panelObservations = observations.filter((observation) => observation.observationGroupId === group.id);
  const inputs = phenoAgeInputs.map(([code, label, normalizedUnit]) => {
    const observation = [...panelObservations]
      .filter((entry) => entry.measurementCode === code)
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
    return inputFromObservation(code, label, normalizedUnit, observation);
  });
  return { collectedAt: groupDate(group, observations), inputs };
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
  if (!observation) return { code, label, normalizedUnit, status: "missing", detail: "Not found in the selected lab panel." };
  const normalizedValue = normalizeValue(code, observation.value, observation.unit);
  if (normalizedValue === undefined) {
    return {
      code, label, value: observation.value, unit: observation.unit, normalizedUnit, observedAt: observation.observedAt,
      status: "invalid", detail: `Unsupported unit "${observation.unit}" or invalid value.`
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

function groupDate(group: ObservationGroup, observations: Observation[]): string {
  return group.collectedAt ?? observations
    .filter((observation) => observation.observationGroupId === group.id)
    .map((observation) => observation.observedAt)
    .sort()
    .at(-1) ?? "";
}

function ageForDate(birthYear: number | undefined, date: string): number | undefined {
  if (!birthYear || !Number.isInteger(birthYear)) return undefined;
  const year = new Date(date).getUTCFullYear();
  const age = year - birthYear;
  return Number.isFinite(age) && age >= 18 && age <= 120 ? age : undefined;
}
