import type { MeasurementType, ReferenceRange, UnitSystem } from "./types.js";

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
    canonicalUnit: "beats/min",
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
    code: "height",
    display: "Height",
    category: "body",
    kind: "point",
    canonicalUnit: "cm",
    aliases: ["height", "body height", "stature"],
    openMHealthSchema: "body-height",
    aggregation: "latest"
  },
  {
    code: "body_fat_pct",
    display: "Body fat percentage",
    category: "body",
    kind: "point",
    canonicalUnit: "%",
    aliases: ["body fat", "body fat percentage", "body fat %", "fat %", "fat pct", "fat percent", "fat percentage", "pbf", "percent body fat"],
    openMHealthSchema: "body-fat-percentage",
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
    aliases: ["lean body mass", "lean mass", "fat free mass", "fat-free mass", "ffm"],
    aggregation: "latest"
  },
  {
    code: "bmi",
    display: "BMI",
    category: "body",
    kind: "point",
    canonicalUnit: "kg/m2",
    aliases: ["bmi", "body mass index"],
    openMHealthSchema: "body-mass-index",
    normalLow: 18.5,
    normalHigh: 24.9,
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
    canonicalUnit: "kcal/day",
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
    code: "bone_mineral_density",
    display: "Bone mineral density",
    category: "body",
    kind: "point",
    canonicalUnit: "g/cm2",
    aliases: ["bone mineral density", "bmd"],
    aggregation: "latest"
  },
  {
    code: "body_cell_mass",
    display: "Body cell mass",
    category: "body",
    kind: "point",
    canonicalUnit: "kg",
    aliases: ["body cell mass", "bcm"],
    aggregation: "latest"
  },
  {
    code: "intracellular_water",
    display: "Intracellular water",
    category: "body",
    kind: "point",
    canonicalUnit: "L",
    aliases: ["intracellular water", "icw"],
    aggregation: "latest"
  },
  {
    code: "extracellular_water",
    display: "Extracellular water",
    category: "body",
    kind: "point",
    canonicalUnit: "L",
    aliases: ["extracellular water", "ecw"],
    aggregation: "latest"
  },
  {
    code: "extracellular_water_ratio",
    display: "Extracellular water ratio",
    category: "body",
    kind: "point",
    canonicalUnit: "dimensionless",
    aliases: ["extracellular water ratio", "ecw tbw ratio", "ecw/tbw"],
    aggregation: "latest"
  },
  {
    code: "visceral_fat_area",
    display: "Visceral fat area",
    category: "body",
    kind: "point",
    canonicalUnit: "cm2",
    aliases: ["visceral fat area", "vfa"],
    aggregation: "latest"
  },
  {
    code: "subcutaneous_fat_mass",
    display: "Subcutaneous fat mass",
    category: "body",
    kind: "point",
    canonicalUnit: "kg",
    aliases: ["subcutaneous fat mass", "subcutaneous fat"],
    aggregation: "latest"
  },
  {
    code: "waist_circumference",
    display: "Waist circumference",
    category: "body",
    kind: "point",
    canonicalUnit: "cm",
    aliases: ["waist circumference", "waist"],
    aggregation: "latest"
  },
  {
    code: "hip_circumference",
    display: "Hip circumference",
    category: "body",
    kind: "point",
    canonicalUnit: "cm",
    aliases: ["hip circumference", "hips"],
    aggregation: "latest"
  },
  {
    code: "waist_hip_ratio",
    display: "Waist-to-hip ratio",
    category: "body",
    kind: "point",
    canonicalUnit: "dimensionless",
    aliases: ["waist hip ratio", "waist-to-hip ratio", "whr"],
    aggregation: "latest"
  },
  {
    code: "metabolic_age",
    display: "Metabolic age",
    category: "body",
    kind: "point",
    canonicalUnit: "years",
    aliases: ["metabolic age", "body age"],
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
    openMHealthSchema: "total-sleep-time",
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
    code: "respiratory_rate",
    display: "Respiratory rate",
    category: "cardio",
    kind: "point",
    canonicalUnit: "breaths/min",
    aliases: ["respiratory rate", "breathing rate", "respiration rate"],
    openMHealthSchema: "respiratory-rate",
    normalLow: 12,
    normalHigh: 20,
    aggregation: "average"
  },
  {
    code: "body_temperature",
    display: "Body temperature",
    category: "cardio",
    kind: "point",
    canonicalUnit: "°C",
    aliases: ["body temperature", "temperature"],
    normalLow: 36.1,
    normalHigh: 37.2,
    aggregation: "average"
  },
  {
    code: "basal_body_temperature",
    display: "Basal body temperature",
    category: "cardio",
    kind: "point",
    canonicalUnit: "°C",
    aliases: ["basal body temperature", "basal temperature", "bbt"],
    aggregation: "average"
  },
  {
    code: "skin_temperature",
    display: "Skin temperature",
    category: "cardio",
    kind: "point",
    canonicalUnit: "°C",
    aliases: ["skin temperature", "skin temp", "temperature skin"],
    aggregation: "average"
  },
  {
    code: "blood_pressure_systolic",
    display: "Systolic blood pressure",
    category: "cardio",
    kind: "point",
    canonicalUnit: "mmHg",
    aliases: ["systolic blood pressure", "systolic", "sbp"],
    openMHealthSchema: "systolic-blood-pressure",
    normalLow: 90,
    normalHigh: 120,
    aggregation: "latest"
  },
  {
    code: "blood_pressure_diastolic",
    display: "Diastolic blood pressure",
    category: "cardio",
    kind: "point",
    canonicalUnit: "mmHg",
    aliases: ["diastolic blood pressure", "diastolic", "dbp"],
    openMHealthSchema: "diastolic-blood-pressure",
    normalLow: 60,
    normalHigh: 80,
    aggregation: "latest"
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
    code: "active_energy_burned",
    display: "Active energy burned",
    category: "activity",
    kind: "interval",
    canonicalUnit: "kcal",
    aliases: ["active energy", "active calories", "calories burned", "calorie burned"],
    openMHealthSchema: "calorie-burned",
    aggregation: "sum"
  },
  {
    code: "distance",
    display: "Distance",
    category: "activity",
    kind: "interval",
    canonicalUnit: "m",
    aliases: ["distance", "distance travelled", "distance traveled"],
    aggregation: "sum"
  },
  {
    code: "physical_activity_duration",
    display: "Physical activity duration",
    category: "activity",
    kind: "interval",
    canonicalUnit: "min",
    aliases: ["physical activity", "activity duration", "exercise duration"],
    openMHealthSchema: "physical-activity",
    aggregation: "sum"
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
    canonicalUnit: "mmol/mol",
    aliases: ["hba1c", "hemoglobin a1c", "haemoglobin a1c", "a1c"],
    fhirCode: "59261-8",
    loincCode: "59261-8",
    normalHigh: 41,
    aggregation: "latest"
  },
  {
    code: "glucose",
    display: "Glucose",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mmol/L",
    aliases: ["glucose", "blood glucose", "fasting glucose"],
    fhirCode: "2345-7",
    loincCode: "2345-7",
    openMHealthSchema: "blood-glucose",
    normalLow: 3.9,
    normalHigh: 5.5,
    aggregation: "latest"
  },
  {
    code: "total_cholesterol",
    display: "Total cholesterol",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mmol/L",
    aliases: ["total cholesterol", "cholesterol total", "cholesterol"],
    fhirCode: "2093-3",
    loincCode: "2093-3",
    normalHigh: 5.2,
    aggregation: "latest"
  },
  {
    code: "hdl_cholesterol",
    display: "HDL cholesterol",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mmol/L",
    aliases: ["hdl", "hdl cholesterol"],
    fhirCode: "2085-9",
    loincCode: "2085-9",
    normalLow: 1,
    aggregation: "latest"
  },
  {
    code: "ldl_cholesterol",
    display: "LDL cholesterol",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mmol/L",
    aliases: ["ldl", "ldl cholesterol"],
    fhirCode: "13457-7",
    loincCode: "13457-7",
    normalHigh: 3,
    aggregation: "latest"
  },
  {
    code: "triglycerides",
    display: "Triglycerides",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mmol/L",
    aliases: ["triglycerides", "tg"],
    fhirCode: "2571-8",
    loincCode: "2571-8",
    normalHigh: 1.7,
    aggregation: "latest"
  },
  {
    code: "albumin",
    display: "Albumin",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "g/L",
    aliases: ["albumin", "serum albumin", "alb"],
    loincCode: "1751-7",
    normalLow: 35,
    normalHigh: 50,
    aggregation: "latest"
  },
  {
    code: "alkaline_phosphatase",
    display: "Alkaline phosphatase",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "U/L",
    aliases: ["alkaline phosphatase", "alkaline phosphatase total", "alp", "alk phos"],
    loincCode: "6768-6",
    aggregation: "latest"
  },
  {
    code: "alanine_aminotransferase",
    display: "Alanine aminotransferase",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "U/L",
    aliases: ["alanine aminotransferase", "alt", "sgpt"],
    loincCode: "1742-6",
    aggregation: "latest"
  },
  {
    code: "aspartate_aminotransferase",
    display: "Aspartate aminotransferase",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "U/L",
    aliases: ["aspartate aminotransferase", "ast", "sgot"],
    loincCode: "1920-8",
    aggregation: "latest"
  },
  {
    code: "bilirubin_total",
    display: "Total bilirubin",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "µmol/L",
    aliases: ["total bilirubin", "bilirubin"],
    loincCode: "1975-2",
    aggregation: "latest"
  },
  {
    code: "calcium",
    display: "Calcium",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mmol/L",
    aliases: ["calcium", "serum calcium"],
    loincCode: "17861-6",
    normalLow: 2.1,
    normalHigh: 2.6,
    aggregation: "latest"
  },
  {
    code: "chloride",
    display: "Chloride",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mmol/L",
    aliases: ["chloride", "serum chloride"],
    loincCode: "2075-0",
    normalLow: 95,
    normalHigh: 105,
    aggregation: "latest"
  },
  {
    code: "creatinine",
    display: "Creatinine",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "µmol/L",
    aliases: ["creatinine", "serum creatinine"],
    loincCode: "2160-0",
    aggregation: "latest"
  },
  {
    code: "urea",
    display: "Urea",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mmol/L",
    aliases: ["urea", "blood urea nitrogen", "bun"],
    loincCode: "3094-0",
    aggregation: "latest"
  },
  {
    code: "ferritin",
    display: "Ferritin",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "µg/L",
    aliases: ["ferritin", "serum ferritin"],
    loincCode: "2276-4",
    aggregation: "latest"
  },
  {
    code: "gamma_glutamyl_transferase",
    display: "Gamma-glutamyl transferase",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "U/L",
    aliases: ["gamma glutamyl transferase", "ggt", "gamma gt"],
    loincCode: "2324-2",
    aggregation: "latest"
  },
  {
    code: "iron",
    display: "Iron",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "µmol/L",
    aliases: ["iron", "serum iron"],
    loincCode: "2498-4",
    normalLow: 9,
    normalHigh: 31,
    aggregation: "latest"
  },
  {
    code: "potassium",
    display: "Potassium",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mmol/L",
    aliases: ["potassium", "serum potassium"],
    loincCode: "2823-3",
    normalLow: 3.5,
    normalHigh: 5,
    aggregation: "latest"
  },
  {
    code: "sodium",
    display: "Sodium",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mmol/L",
    aliases: ["sodium", "serum sodium"],
    loincCode: "2951-2",
    normalLow: 135,
    normalHigh: 145,
    aggregation: "latest"
  },
  {
    code: "total_protein",
    display: "Total protein",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "g/L",
    aliases: ["total protein", "serum total protein"],
    loincCode: "2885-2",
    normalLow: 60,
    normalHigh: 80,
    aggregation: "latest"
  },
  {
    code: "thyroid_stimulating_hormone",
    display: "Thyroid-stimulating hormone",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mIU/L",
    aliases: ["thyroid stimulating hormone", "tsh"],
    loincCode: "3016-3",
    aggregation: "latest"
  },
  {
    code: "uric_acid",
    display: "Uric acid",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "µmol/L",
    aliases: ["uric acid", "urate"],
    loincCode: "3084-1",
    aggregation: "latest"
  },
  {
    code: "vitamin_b12",
    display: "Vitamin B12",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "pmol/L",
    aliases: ["vitamin b12", "b12", "cobalamin"],
    loincCode: "2132-9",
    aggregation: "latest"
  },
  {
    code: "vitamin_d",
    display: "Vitamin D",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "nmol/L",
    aliases: ["vitamin d", "25 hydroxy vitamin d", "25-oh vitamin d", "25(oh)d"],
    loincCode: "1989-3",
    aggregation: "latest"
  },
  {
    code: "high_sensitivity_c_reactive_protein",
    display: "High-sensitivity C-reactive protein",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mg/L",
    aliases: ["high sensitivity c reactive protein", "c reactive protein", "c-reactive protein", "hs crp", "hs-crp", "crp"],
    loincCode: "30522-7",
    aggregation: "latest"
  },
  {
    code: "white_blood_cell_count",
    display: "White blood cell count",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "×10⁹/L",
    aliases: ["white blood cell count", "white blood cells", "white cell count", "wbc"],
    loincCode: "6690-2",
    normalLow: 4,
    normalHigh: 11,
    aggregation: "latest"
  },
  {
    code: "red_blood_cell_count",
    display: "Red blood cell count",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "×10¹²/L",
    aliases: ["red blood cell count", "red blood cells", "rbc"],
    loincCode: "789-8",
    aggregation: "latest"
  },
  {
    code: "haemoglobin",
    display: "Haemoglobin",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "g/L",
    aliases: ["haemoglobin", "hemoglobin", "hgb", "hb"],
    loincCode: "718-7",
    aggregation: "latest"
  },
  {
    code: "haematocrit",
    display: "Haematocrit",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "L/L",
    aliases: ["haematocrit", "hematocrit", "hct"],
    loincCode: "4544-3",
    aggregation: "latest"
  },
  {
    code: "mean_corpuscular_volume",
    display: "Mean corpuscular volume",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "fL",
    aliases: ["mean corpuscular volume", "mcv"],
    loincCode: "787-2",
    normalLow: 80,
    normalHigh: 100,
    aggregation: "latest"
  },
  {
    code: "mean_corpuscular_haemoglobin",
    display: "Mean corpuscular haemoglobin",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "pg",
    aliases: ["mean corpuscular haemoglobin", "mean corpuscular hemoglobin", "mch"],
    loincCode: "785-6",
    normalLow: 27,
    normalHigh: 33,
    aggregation: "latest"
  },
  {
    code: "mean_corpuscular_haemoglobin_concentration",
    display: "Mean corpuscular haemoglobin concentration",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "g/L",
    aliases: ["mean corpuscular haemoglobin concentration", "mean corpuscular hemoglobin concentration", "mchc"],
    loincCode: "786-4",
    aggregation: "latest"
  },
  {
    code: "red_cell_distribution_width",
    display: "Red cell distribution width",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "%",
    aliases: ["red cell distribution width", "red cell distribution width cv", "rdw"],
    loincCode: "788-0",
    aggregation: "latest"
  },
  {
    code: "platelet_count",
    display: "Platelet count",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "×10⁹/L",
    aliases: ["platelet count", "platelets", "plt"],
    loincCode: "777-3",
    normalLow: 150,
    normalHigh: 400,
    aggregation: "latest"
  },
  {
    code: "lymphocyte_percentage",
    display: "Lymphocytes",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "%",
    aliases: ["lymphocytes", "lymphocyte percentage", "lymphocyte %", "lymph %"],
    loincCode: "736-9",
    aggregation: "latest"
  },
  {
    code: "apolipoprotein_b",
    display: "Apolipoprotein B",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "g/L",
    aliases: ["apolipoprotein b", "apob", "apo b"],
    loincCode: "1884-6",
    aggregation: "latest"
  },
  {
    code: "lipoprotein_a",
    display: "Lipoprotein(a)",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "nmol/L",
    aliases: ["lipoprotein(a)", "lipoprotein a", "lp(a)", "lpa"],
    loincCode: "43583-4",
    aggregation: "latest"
  },
  {
    code: "insulin",
    display: "Insulin",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "pmol/L",
    aliases: ["insulin", "fasting insulin"],
    loincCode: "20448-7",
    aggregation: "latest"
  },
  {
    code: "estimated_glomerular_filtration_rate",
    display: "Estimated glomerular filtration rate",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mL/min/1.73m2",
    aliases: ["estimated glomerular filtration rate", "egfr"],
    loincCode: "62238-1",
    aggregation: "latest"
  },
  {
    code: "total_iron_binding_capacity",
    display: "Total iron-binding capacity",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "µmol/L",
    aliases: ["total iron binding capacity", "tibc"],
    loincCode: "2500-7",
    aggregation: "latest"
  },
  {
    code: "transferrin_saturation",
    display: "Transferrin saturation",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "%",
    aliases: ["transferrin saturation", "iron saturation", "tsat"],
    loincCode: "2502-3",
    aggregation: "latest"
  },
  {
    code: "neutrophil_percentage",
    display: "Neutrophils",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "%",
    aliases: ["neutrophils", "neutrophil percentage", "neutrophil %", "neut %"],
    loincCode: "770-8",
    aggregation: "latest"
  },
  {
    code: "folate",
    display: "Folate",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "nmol/L",
    aliases: ["folate", "folic acid"],
    loincCode: "2284-8",
    aggregation: "latest"
  },
  {
    code: "magnesium",
    display: "Magnesium",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mmol/L",
    aliases: ["magnesium", "serum magnesium"],
    loincCode: "19123-9",
    aggregation: "latest"
  },
  {
    code: "phosphate",
    display: "Phosphate",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mmol/L",
    aliases: ["phosphate", "phosphorus", "serum phosphate"],
    loincCode: "2777-1",
    normalLow: 0.8,
    normalHigh: 1.5,
    aggregation: "latest"
  },
  {
    code: "testosterone_total",
    display: "Total testosterone",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "nmol/L",
    aliases: ["total testosterone", "testosterone"],
    loincCode: "2986-8",
    aggregation: "latest"
  },
  {
    code: "sex_hormone_binding_globulin",
    display: "Sex hormone-binding globulin",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "nmol/L",
    aliases: ["sex hormone binding globulin", "shbg"],
    loincCode: "13967-5",
    aggregation: "latest"
  },
  {
    code: "free_testosterone",
    display: "Free testosterone",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "pmol/L",
    aliases: ["free testosterone"],
    loincCode: "2990-0",
    aggregation: "latest"
  },
  {
    code: "dehydroepiandrosterone_sulfate",
    display: "Dehydroepiandrosterone sulfate",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "µmol/L",
    aliases: ["dehydroepiandrosterone sulfate", "dheas", "dhea-s"],
    loincCode: "2191-5",
    aggregation: "latest"
  },
  {
    code: "cortisol",
    display: "Cortisol",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "nmol/L",
    aliases: ["cortisol"],
    loincCode: "2143-6",
    aggregation: "latest"
  },
  {
    code: "free_thyroxine",
    display: "Free thyroxine",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "pmol/L",
    aliases: ["free thyroxine", "free t4", "ft4"],
    loincCode: "3024-7",
    aggregation: "latest"
  },
  {
    code: "free_triiodothyronine",
    display: "Free triiodothyronine",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "pmol/L",
    aliases: ["free triiodothyronine", "free t3", "ft3"],
    loincCode: "3053-6",
    aggregation: "latest"
  },
  {
    code: "insulin_like_growth_factor_1",
    display: "Insulin-like growth factor 1",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "nmol/L",
    aliases: ["insulin like growth factor 1", "igf 1", "igf-1"],
    loincCode: "10334-1",
    aggregation: "latest"
  },
  {
    code: "homocysteine",
    display: "Homocysteine",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "µmol/L",
    aliases: ["homocysteine"],
    loincCode: "13965-9",
    aggregation: "latest"
  },
  {
    code: "omega_3_index",
    display: "Omega-3 index",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "%",
    aliases: ["omega 3 index", "omega-3 index", "epa dha index"],
    aggregation: "latest"
  },
  {
    code: "rr_interval",
    display: "RR interval",
    category: "cardio",
    kind: "point",
    canonicalUnit: "ms",
    aliases: ["rr interval", "r-r interval"],
    openMHealthSchema: "rr-interval",
    aggregation: "average"
  },
  {
    code: "expiratory_time",
    display: "Expiratory time",
    category: "cardio",
    kind: "point",
    canonicalUnit: "sec",
    aliases: ["expiratory time"],
    openMHealthSchema: "expiratory-time",
    aggregation: "average"
  },
  {
    code: "forced_expiratory_volume_1",
    display: "Forced expiratory volume in one second",
    category: "cardio",
    kind: "point",
    canonicalUnit: "L",
    aliases: ["forced expiratory volume 1", "fev1", "fev 1"],
    aggregation: "latest"
  },
  {
    code: "forced_vital_capacity",
    display: "Forced vital capacity",
    category: "cardio",
    kind: "point",
    canonicalUnit: "L",
    aliases: ["forced vital capacity", "fvc"],
    aggregation: "latest"
  },
  {
    code: "fev1_fvc_ratio",
    display: "FEV1/FVC ratio",
    category: "cardio",
    kind: "point",
    canonicalUnit: "dimensionless",
    aliases: ["fev1 fvc ratio", "fev1/fvc"],
    aggregation: "latest"
  },
  {
    code: "grip_strength",
    display: "Grip strength",
    category: "body",
    kind: "point",
    canonicalUnit: "kg",
    aliases: ["grip strength", "hand grip strength"],
    aggregation: "latest"
  },
  {
    code: "vo2_max",
    display: "VO2 max",
    category: "cardio",
    kind: "point",
    canonicalUnit: "mL/kg/min",
    aliases: ["vo2 max", "vo2max", "vo2 peak"],
    aggregation: "latest"
  },
  {
    code: "gait_speed",
    display: "Gait speed",
    category: "activity",
    kind: "point",
    canonicalUnit: "m/s",
    aliases: ["gait speed", "walking speed"],
    aggregation: "latest"
  },
  {
    code: "reaction_time",
    display: "Reaction time",
    category: "derived",
    kind: "point",
    canonicalUnit: "ms",
    aliases: ["reaction time"],
    aggregation: "latest"
  }
];

for (const type of defaultMeasurementTypes) {
  type.preferredUnits = preferredUnitsFor(type);
  type.unitAliases = unitAliasesFor(type);
  if (type.normalLow !== undefined || type.normalHigh !== undefined) {
    type.referenceRanges = [{
      ...(type.normalLow === undefined ? {} : { low: type.normalLow }),
      ...(type.normalHigh === undefined ? {} : { high: type.normalHigh }),
      unit: type.canonicalUnit
    }];
  }
}

export const MANUAL_LAB_MARKER_CATALOG = defaultMeasurementTypes
  .filter((type) => type.category === "lab")
  .map((type) => ({ marker: type.display, unit: type.canonicalUnit, measurementCode: type.code }));

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

export function normalizeMeasurementUnit(type: MeasurementType, unit: string): string {
    const normalized = unit.trim().toLowerCase().replaceAll("μ", "µ").replaceAll(" ", "");
    for (const [canonical, aliases] of Object.entries(type.unitAliases ?? {})) {
      if ([canonical, ...aliases].some((candidate) => candidate.toLowerCase().replaceAll("μ", "µ").replaceAll(" ", "") === normalized)) {
        return canonical.toLowerCase().replaceAll("μ", "µ").replaceAll(" ", "");
}
    }
    return normalized;
  }

function preferredUnitsFor(type: MeasurementType): Partial<Record<UnitSystem, string>> {
    const imperialUnit = imperialUnitFor(type);
    return imperialUnit ? { metric: type.canonicalUnit, imperial: imperialUnit } : { metric: type.canonicalUnit };
}

function unitAliasesFor(type: MeasurementType): Record<string, string[]> {
    const aliases: Record<string, string[]> = {
      kg: ["kgs", "kilogram", "kilograms"],
      lb: ["lbs", "pound", "pounds"],
      cm: ["centimeter", "centimeters"],
      in: ["inch", "inches"],
      L: ["l", "litre", "litres", "liter", "liters"],
      "fl oz": ["floz", "fluid ounce", "fluid ounces"],
      "°C": ["c", "celsius"],
      "°F": ["f", "fahrenheit"],
      "mg/dL": ["mg/dl", "mg / dl"],
      "mmol/L": ["mmol/l", "mmol / l"],
      "µmol/L": ["μmol/l", "umol/l", "µmol/l"],
      "g/dL": ["g/dl"],
      "g/L": ["g/l"],
      "%": ["percent"]
    };
    const preferred = type.preferredUnits?.imperial;
    return Object.fromEntries(
      [type.canonicalUnit, preferred].filter((unit): unit is string => Boolean(unit)).map((unit) => [unit, aliases[unit] ?? []])
    );
}

function imperialUnitFor(type: MeasurementType): string | undefined {
    if (type.canonicalUnit === "kg") return "lb";
    if (type.canonicalUnit === "cm") return "in";
    if (type.canonicalUnit === "°C") return "°F";
    if (type.canonicalUnit === "L" && type.category === "body") return "fl oz";
    if (type.code === "glucose" || type.code === "total_cholesterol" || type.code === "hdl_cholesterol" || type.code === "ldl_cholesterol" || type.code === "triglycerides" || type.code === "creatinine" || type.code === "uric_acid") return "mg/dL";
    if (type.code === "hba1c") return "%";
    if (type.code === "hemoglobin") return "g/dL";
    return undefined;
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
    if (from === "mmol/l" && to === "mg/dl") return reciprocal(mgPerDlFactor(code));
    if (from === "mg/dl" && to === "mmol/l") return reciprocal(1 / mgPerDlFactor(code));
    if (code === "hba1c" && from === "mmol/mol" && to === "%") return (value) => value * 0.09148 + 2.152;
    if (code === "hba1c" && from === "%" && to === "mmol/mol") return (value) => (value - 2.152) / 0.09148;
    if (code === "hemoglobin" && from === "g/l" && to === "g/dl") return reciprocal(0.1);
    if (code === "hemoglobin" && from === "g/dl" && to === "g/l") return reciprocal(10);
    return undefined;
}

function mgPerDlFactor(code: string): number {
    if (code === "creatinine") return 88.4;
    if (code === "uric_acid") return 16.81;
    if (code === "triglycerides") return 88.57;
    if (code === "total_cholesterol" || code === "hdl_cholesterol" || code === "ldl_cholesterol") return 38.67;
    return 18.0182;
}
