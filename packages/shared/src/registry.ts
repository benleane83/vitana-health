import type { MeasurementType } from "./types.js";

export const defaultMeasurementTypes: MeasurementType[] = [
  {
    code: "steps",
    display: "Steps",
    category: "activity",
    kind: "interval",
    canonicalUnit: "count",
    aliases: ["step_count", "count", "steps"],
    openMHealthSchema: "step-count",
    aggregation: "sum"
  },
  {
    code: "heart_rate",
    display: "Heart rate",
    category: "cardio",
    kind: "point",
    canonicalUnit: "bpm",
    aliases: ["heart_rate", "heart rate", "pulse"],
    fhirCode: "8867-4",
    loincCode: "8867-4",
    openMHealthSchema: "heart-rate",
    normalLow: 50,
    normalHigh: 100,
    aggregation: "average"
  },
  {
    code: "weight",
    display: "Weight",
    category: "body",
    kind: "point",
    canonicalUnit: "kg",
    aliases: ["weight", "body_weight", "body weight"],
    fhirCode: "29463-7",
    loincCode: "29463-7",
    openMHealthSchema: "body-weight",
    aggregation: "latest"
  },
  {
    code: "body_fat_pct",
    display: "Body fat percentage",
    category: "body",
    kind: "point",
    canonicalUnit: "%",
    aliases: ["body fat", "body fat percentage", "body fat %", "fat %", "fat pct", "fat percent", "fat percentage", "pbf", "percent body fat"],
    aggregation: "latest"
  },
  {
    code: "skeletal_muscle_mass",
    display: "Skeletal muscle mass",
    category: "body",
    kind: "point",
    canonicalUnit: "kg",
    aliases: ["skeletal muscle mass", "smm", "muscle mass", "skeletal muscle"],
    aggregation: "latest"
  },
  {
    code: "fat_mass",
    display: "Fat mass",
    category: "body",
    kind: "point",
    canonicalUnit: "kg",
    aliases: ["fat mass", "body fat mass", "bfm"],
    aggregation: "latest"
  },
  {
    code: "lean_body_mass",
    display: "Lean body mass",
    category: "body",
    kind: "point",
    canonicalUnit: "kg",
    aliases: ["lean body mass", "lean mass", "fat free mass", "ffm"],
    aggregation: "latest"
  },
  {
    code: "bmi",
    display: "BMI",
    category: "body",
    kind: "point",
    canonicalUnit: "kg/m2",
    aliases: ["bmi", "body mass index"],
    aggregation: "latest"
  },
  {
    code: "visceral_fat_level",
    display: "Visceral fat level",
    category: "body",
    kind: "point",
    canonicalUnit: "level",
    aliases: ["visceral fat", "visceral fat level", "vfl", "visceral fat rating"],
    aggregation: "latest"
  },
  {
    code: "total_body_water",
    display: "Total body water",
    category: "body",
    kind: "point",
    canonicalUnit: "L",
    aliases: ["total body water", "body water", "tbw", "bw", "water"],
    aggregation: "latest"
  },
  {
    code: "body_water_pct",
    display: "Body water percentage",
    category: "body",
    kind: "point",
    canonicalUnit: "%",
    aliases: ["body water percentage", "body water %", "tbw %", "water percentage", "water %"],
    aggregation: "latest"
  },
  {
    code: "basal_metabolic_rate",
    display: "Basal metabolic rate",
    category: "body",
    kind: "point",
    canonicalUnit: "kcal",
    aliases: ["basal metabolic rate", "bmr", "basal metabolism", "resting metabolic rate"],
    aggregation: "latest"
  },
  {
    code: "bone_mineral_content",
    display: "Bone mineral content",
    category: "body",
    kind: "point",
    canonicalUnit: "kg",
    aliases: ["bone mineral content", "bone mass", "mineral", "minerals", "bone mineral"],
    aggregation: "latest"
  },
  {
    code: "protein_mass",
    display: "Protein mass",
    category: "body",
    kind: "point",
    canonicalUnit: "kg",
    aliases: ["protein", "protein mass"],
    aggregation: "latest"
  },
  {
    code: "sleep_duration",
    display: "Sleep duration",
    category: "sleep",
    kind: "interval",
    canonicalUnit: "min",
    aliases: ["sleep", "sleep_duration", "sleep duration"],
    openMHealthSchema: "sleep-duration",
    normalLow: 420,
    normalHigh: 540,
    aggregation: "sum"
  },
  {
    code: "oxygen_saturation",
    display: "Oxygen saturation",
    category: "cardio",
    kind: "interval",
    canonicalUnit: "%",
    aliases: ["spo2", "oxygen_saturation", "oxygen saturation"],
    normalLow: 92,
    normalHigh: 100,
    aggregation: "average"
  },
  {
    code: "hrv_sdnn",
    display: "HRV SDNN",
    category: "cardio",
    kind: "point",
    canonicalUnit: "ms",
    aliases: ["sdnn", "hrv_sdnn", "heart rate variability sdnn"],
    aggregation: "latest"
  },
  {
    code: "hrv_rmssd",
    display: "HRV RMSSD",
    category: "cardio",
    kind: "point",
    canonicalUnit: "ms",
    aliases: ["rmssd", "hrv_rmssd", "heart rate variability rmssd"],
    aggregation: "latest"
  },
  {
    code: "activity_level",
    display: "Activity level",
    category: "activity",
    kind: "interval",
    canonicalUnit: "score",
    aliases: ["activity_level", "activity level"],
    aggregation: "average"
  },
  {
    code: "exercise_speed",
    display: "Exercise speed",
    category: "activity",
    kind: "point",
    canonicalUnit: "m/s",
    aliases: ["speed", "exercise_speed", "exercise speed"],
    aggregation: "average"
  },
  {
    code: "hba1c",
    display: "HbA1c",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "%",
    aliases: ["hba1c", "hemoglobin a1c", "a1c"],
    fhirCode: "4548-4",
    loincCode: "4548-4",
    normalHigh: 5.7,
    aggregation: "latest"
  },
  {
    code: "glucose",
    display: "Glucose",
    category: "metabolic",
    kind: "panel-component",
    canonicalUnit: "mg/dL",
    aliases: ["glucose", "blood glucose", "fasting glucose"],
    fhirCode: "2345-7",
    loincCode: "2345-7",
    normalLow: 70,
    normalHigh: 99,
    aggregation: "latest"
  },
  {
    code: "total_cholesterol",
    display: "Total cholesterol",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mg/dL",
    aliases: ["total cholesterol", "cholesterol total", "cholesterol"],
    fhirCode: "2093-3",
    loincCode: "2093-3",
    normalHigh: 200,
    aggregation: "latest"
  },
  {
    code: "hdl_cholesterol",
    display: "HDL cholesterol",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mg/dL",
    aliases: ["hdl", "hdl cholesterol"],
    fhirCode: "2085-9",
    loincCode: "2085-9",
    normalLow: 40,
    aggregation: "latest"
  },
  {
    code: "ldl_cholesterol",
    display: "LDL cholesterol",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mg/dL",
    aliases: ["ldl", "ldl cholesterol"],
    fhirCode: "13457-7",
    loincCode: "13457-7",
    normalHigh: 100,
    aggregation: "latest"
  },
  {
    code: "triglycerides",
    display: "Triglycerides",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mg/dL",
    aliases: ["triglycerides", "tg"],
    fhirCode: "2571-8",
    loincCode: "2571-8",
    normalHigh: 150,
    aggregation: "latest"
  }
];

export function findMeasurementType(input: string, registry = defaultMeasurementTypes): MeasurementType | undefined {
  const normalized = input.trim().toLowerCase().replaceAll("_", " ");
  return registry.find((type) => {
    if (type.code.replaceAll("_", " ") === normalized) {
      return true;
    }
    return type.aliases.some((alias) => alias.trim().toLowerCase().replaceAll("_", " ") === normalized);
  });
}

export function classifyValue(
  value: number,
  type: MeasurementType,
  low = type.normalLow,
  high = type.normalHigh
): "low" | "normal" | "high" | "unknown" {
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

