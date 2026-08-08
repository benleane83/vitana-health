import type { MeasurementType, ReferenceRange, UnitSystem } from "./types.js";

/**
 * The hand-authored registry. Derived fields (`preferredUnits`, `unitAliases`, `referenceRanges`)
 * are computed once into the frozen `defaultMeasurementTypes` below rather than assigned back onto
 * these objects, because the exported array is shared by reference across web, mobile, API, and
 * desktop — an in-place mutation by any one consumer would corrupt the registry process-wide.
 */
const measurementTypeDefinitions: MeasurementType[] = [
  {
    code: "steps",
    display: "Steps",
    description: "The number of steps you have taken, as counted by a pedometer, fitness tracker, or phone.",
    category: "activity",
    kind: "interval",
    canonicalUnit: "count",
    aliases: ["step_count", "count", "steps"],
    loincCode: "41950-7",
    openMHealthSchema: "step-count",
    aggregation: "sum"
  },
  {
    code: "heart_rate",
    display: "Heart rate",
    description: "The number of times your heart beats per minute.",
    category: "cardio",
    kind: "point",
    canonicalUnit: "beats/min",
    aliases: ["heart_rate", "heart rate", "pulse"],
    loincCode: "8867-4",
    openMHealthSchema: "heart-rate",
    normalLow: 50,
    normalHigh: 100,
    aggregation: "average"
  },
  {
    code: "weight",
    display: "Weight",
    description: "Your total body weight.",
    category: "body",
    kind: "point",
    canonicalUnit: "kg",
    aliases: ["weight", "body_weight", "body weight"],
    loincCode: "29463-7",
    openMHealthSchema: "body-weight",
    aggregation: "latest"
  },
  {
    code: "height",
    display: "Height",
    description: "Your standing body height.",
    category: "body",
    kind: "point",
    canonicalUnit: "cm",
    aliases: ["height", "body height", "stature"],
    loincCode: "8302-2",
    openMHealthSchema: "body-height",
    aggregation: "latest"
  },
  {
    code: "body_fat_pct",
    display: "Body fat percentage",
    description: "The proportion of your total body weight made up of fat, usually estimated by a body-composition device.",
    category: "body",
    kind: "point",
    canonicalUnit: "%",
    aliases: ["body fat", "body fat percentage", "body fat %", "fat %", "fat pct", "fat percent", "fat percentage", "pbf", "percent body fat"],
    loincCode: "41982-0",
    openMHealthSchema: "body-fat-percentage",
    aggregation: "latest"
  },
  {
    code: "muscle_mass",
    display: "Muscle mass",
    description: "The estimated total weight of your muscle tissue, as reported by a body-composition device.",
    category: "body",
    kind: "point",
    canonicalUnit: "kg",
    aliases: ["muscle mass", "muscle"],
    loincCode: "73964-9",
    aggregation: "latest"
  },
  {
    code: "skeletal_muscle_mass",
    display: "Skeletal muscle mass",
    description: "The estimated weight of the muscles attached to your bones that you use to move.",
    category: "body",
    kind: "point",
    canonicalUnit: "kg",
    aliases: ["skeletal muscle mass", "smm", "skeletal muscle"],
    aggregation: "latest"
  },
  {
    code: "fat_mass",
    display: "Fat mass",
    description: "The estimated total weight of fat tissue in your body.",
    category: "body",
    kind: "point",
    canonicalUnit: "kg",
    aliases: ["fat mass", "body fat mass", "bfm"],
    loincCode: "73708-0",
    aggregation: "latest"
  },
  {
    code: "lean_body_mass",
    display: "Lean body mass",
    description: "The estimated weight of everything in your body that is not fat, including muscle, bone, organs, and water.",
    category: "body",
    kind: "point",
    canonicalUnit: "kg",
    aliases: ["lean body mass", "lean mass", "fat free mass", "fat-free mass", "ffm", "lean body weight"],
    loincCode: "91557-9",
    aggregation: "latest"
  },
  {
    code: "bmi",
    display: "BMI (Body mass index)",
    description: "A number calculated from your height and weight, used as a simple screening measure for weight status.",
    category: "body",
    kind: "point",
    canonicalUnit: "kg/m2",
    aliases: ["bmi", "body mass index"],
    loincCode: "39156-5",
    openMHealthSchema: "body-mass-index",
    normalLow: 18.5,
    normalHigh: 24.9,
    aggregation: "latest"
  },
  {
    code: "visceral_fat_level",
    display: "Visceral fat level",
    description: "A device-specific score estimating fat stored around your internal organs; the scale varies between manufacturers.",
    category: "body",
    kind: "point",
    canonicalUnit: "level",
    aliases: ["visceral fat", "visceral fat level", "vfl", "visceral fat rating"],
    aggregation: "latest"
  },
  {
    code: "total_body_water",
    display: "TBW (Total body water)",
    description: "The estimated total amount of water in your body.",
    category: "body",
    kind: "point",
    canonicalUnit: "L",
    aliases: ["total body water", "body water", "tbw", "bw", "water"],
    loincCode: "41967-1",
    aggregation: "latest"
  },
  {
    code: "body_water_pct",
    display: "Body water percentage",
    description: "The proportion of your total body weight made up of water.",
    category: "body",
    kind: "point",
    canonicalUnit: "%",
    aliases: ["body water percentage", "body water %", "tbw %", "water percentage", "water %"],
    loincCode: "8339-4",
    aggregation: "latest"
  },
  {
    code: "basal_metabolic_rate",
    display: "BMR (Basal metabolic rate)",
    description: "The estimated number of calories your body burns at rest each day to maintain basic functions.",
    category: "body",
    kind: "point",
    canonicalUnit: "kcal/day",
    aliases: ["basal metabolic rate", "bmr", "basal metabolism", "resting metabolic rate"],
    loincCode: "83513-8",
    aggregation: "latest"
  },
  {
    code: "bone_mineral_content",
    display: "Bone mineral content",
    description: "The estimated total amount of mineral, mainly calcium, contained in your bones.",
    category: "body",
    kind: "point",
    canonicalUnit: "kg",
    aliases: ["bone mineral content", "bone mass", "mineral", "minerals", "bone mineral"],
    loincCode: "38269-7",
    aggregation: "latest"
  },
  {
    code: "bone_mineral_density",
    display: "Bone mineral density",
    description: "How densely packed the minerals are in your bones per unit area, typically measured with a bone-density scan.",
    category: "body",
    kind: "point",
    canonicalUnit: "g/cm2",
    aliases: ["bone mineral density", "bmd"],
    loincCode: "46383-6",
    aggregation: "latest"
  },
  {
    code: "body_cell_mass",
    display: "Body cell mass",
    description: "The estimated weight of the metabolically active cells in your body, mainly muscle and organ cells.",
    category: "body",
    kind: "point",
    canonicalUnit: "kg",
    aliases: ["body cell mass", "bcm"],
    aggregation: "latest"
  },
  {
    code: "intracellular_water",
    display: "Intracellular water",
    description: "The estimated amount of water held inside your body's cells.",
    category: "body",
    kind: "point",
    canonicalUnit: "L",
    aliases: ["intracellular water", "icw"],
    loincCode: "49261-4",
    aggregation: "latest"
  },
  {
    code: "extracellular_water",
    display: "Extracellular water",
    description: "The estimated amount of water outside your body's cells, such as in blood plasma and the fluid between cells.",
    category: "body",
    kind: "point",
    canonicalUnit: "L",
    aliases: ["extracellular water", "ecw"],
    loincCode: "49262-2",
    aggregation: "latest"
  },
  {
    code: "extracellular_water_ratio",
    display: "Extracellular water ratio",
    description: "The ratio of extracellular water to total body water, used to describe how body fluid is distributed.",
    category: "body",
    kind: "point",
    canonicalUnit: "dimensionless",
    aliases: ["extracellular water ratio", "ecw tbw ratio", "ecw/tbw"],
    aggregation: "latest"
  },
  {
    code: "visceral_fat_area",
    display: "Visceral fat area",
    description: "An estimate of the cross-sectional area of fat surrounding your abdominal organs.",
    category: "body",
    kind: "point",
    canonicalUnit: "cm2",
    aliases: ["visceral fat area", "vfa"],
    loincCode: "73707-2",
    aggregation: "latest"
  },
  {
    code: "subcutaneous_fat_mass",
    display: "Subcutaneous fat mass",
    description: "The estimated weight of fat stored directly under your skin.",
    category: "body",
    kind: "point",
    canonicalUnit: "kg",
    aliases: ["subcutaneous fat mass", "subcutaneous fat"],
    aggregation: "latest"
  },
  {
    code: "waist_circumference",
    display: "Waist circumference",
    description: "The distance around your waist, usually measured at the level of your navel.",
    category: "body",
    kind: "point",
    canonicalUnit: "cm",
    aliases: ["waist circumference", "waist"],
    loincCode: "56115-9",
    aggregation: "latest"
  },
  {
    code: "hip_circumference",
    display: "Hip circumference",
    description: "The distance around the widest part of your hips and buttocks.",
    category: "body",
    kind: "point",
    canonicalUnit: "cm",
    aliases: ["hip circumference", "hips"],
    loincCode: "8280-0",
    aggregation: "latest"
  },
  {
    code: "waist_hip_ratio",
    display: "Waist-to-hip ratio",
    description: "Your waist circumference divided by your hip circumference.",
    category: "body",
    kind: "point",
    canonicalUnit: "dimensionless",
    aliases: ["waist hip ratio", "waist-to-hip ratio", "whr"],
    loincCode: "97058-2",
    aggregation: "latest"
  },
  {
    code: "metabolic_age",
    display: "Metabolic age",
    description: "A non-clinical estimate that compares your basal metabolic rate with average values for people of different ages.",
    category: "body",
    kind: "point",
    canonicalUnit: "years",
    aliases: ["metabolic age", "body age"],
    aggregation: "latest"
  },
  {
    code: "protein_mass",
    display: "Protein mass",
    description: "The estimated total weight of protein in your body, found mainly in muscle, organs, and skin.",
    category: "body",
    kind: "point",
    canonicalUnit: "kg",
    aliases: ["protein", "protein mass"],
    aggregation: "latest"
  },
  {
    code: "sleep_duration",
    display: "Sleep duration",
    description: "The total amount of time you spent asleep.",
    category: "sleep",
    kind: "interval",
    canonicalUnit: "min",
    aliases: ["sleep", "sleep_duration", "sleep duration"],
    loincCode: "93832-4",
    openMHealthSchema: "total-sleep-time",
    normalLow: 420,
    normalHigh: 540,
    aggregation: "sum"
  },
  {
    code: "oxygen_saturation",
    display: "Oxygen saturation",
    description: "The percentage of oxygen being carried by your red blood cells, usually measured with a pulse oximeter.",
    category: "cardio",
    kind: "interval",
    canonicalUnit: "%",
    aliases: ["spo2", "oxygen_saturation", "oxygen saturation"],
    loincCode: "59408-5",
    normalLow: 92,
    normalHigh: 100,
    aggregation: "average"
  },
  {
    code: "respiratory_rate",
    display: "Respiratory rate",
    description: "The number of breaths you take per minute.",
    category: "cardio",
    kind: "point",
    canonicalUnit: "breaths/min",
    aliases: ["respiratory rate", "breathing rate", "respiration rate"],
    loincCode: "9279-1",
    openMHealthSchema: "respiratory-rate",
    normalLow: 12,
    normalHigh: 20,
    aggregation: "average"
  },
  {
    code: "resting_heart_rate",
    display: "Resting heart rate",
    description: "Your heart rate while at rest, typically measured during sleep or a quiet period.",
    category: "cardio",
    kind: "point",
    canonicalUnit: "beats/min",
    aliases: ["resting heart rate", "resting pulse", "rhr"],
    loincCode: "8350-3",
    openMHealthSchema: "heart-rate",
    normalLow: 50,
    normalHigh: 100,
    aggregation: "average"
  },
  {
    code: "body_temperature",
    display: "Body temperature",
    description: "The temperature of your body.",
    category: "cardio",
    kind: "point",
    canonicalUnit: "°C",
    aliases: ["body temperature", "temperature"],
    loincCode: "8310-5",
    normalLow: 36.1,
    normalHigh: 37.2,
    aggregation: "average"
  },
  {
    code: "basal_body_temperature",
    display: "Basal body temperature",
    description: "Your body temperature measured immediately after waking, before any activity.",
    category: "cardio",
    kind: "point",
    canonicalUnit: "°C",
    aliases: ["basal body temperature", "basal temperature", "bbt"],
    loincCode: "8326-1",
    aggregation: "average"
  },
  {
    code: "skin_temperature",
    display: "Skin temperature",
    description: "The temperature measured at the surface of your skin, which can differ from your core body temperature.",
    category: "cardio",
    kind: "point",
    canonicalUnit: "°C",
    aliases: ["skin temperature", "skin temp", "temperature skin"],
    loincCode: "24668-5",
    aggregation: "average"
  },
  {
    code: "blood_pressure_systolic",
    display: "Systolic blood pressure",
    description: "The pressure in your arteries when your heart beats and pushes blood out, shown as the higher blood pressure number.",
    category: "cardio",
    kind: "point",
    canonicalUnit: "mmHg",
    aliases: ["systolic blood pressure", "systolic", "sbp"],
    loincCode: "8480-6",
    openMHealthSchema: "systolic-blood-pressure",
    normalLow: 90,
    normalHigh: 120,
    aggregation: "latest"
  },
  {
    code: "blood_pressure_diastolic",
    display: "Diastolic blood pressure",
    description: "The pressure in your arteries when your heart rests between beats, shown as the lower blood pressure number.",
    category: "cardio",
    kind: "point",
    canonicalUnit: "mmHg",
    aliases: ["diastolic blood pressure", "diastolic", "dbp"],
    loincCode: "8462-4",
    openMHealthSchema: "diastolic-blood-pressure",
    normalLow: 60,
    normalHigh: 80,
    aggregation: "latest"
  },
  {
    code: "hrv_sdnn",
    display: "HRV SDNN (Heart rate variability)",
    description: "A heart-rate-variability measure of the overall variation in time between consecutive heartbeats during a recording.",
    category: "cardio",
    kind: "point",
    canonicalUnit: "ms",
    aliases: ["sdnn", "hrv_sdnn", "heart rate variability sdnn"],
    loincCode: "80343-6",
    aggregation: "latest"
  },
  {
    code: "hrv_rmssd",
    display: "HRV RMSSD (Heart rate variability)",
    description: "A heart-rate-variability measure of short-term differences in timing between consecutive heartbeats.",
    category: "cardio",
    kind: "point",
    canonicalUnit: "ms",
    aliases: ["rmssd", "hrv_rmssd", "heart rate variability rmssd"],
    loincCode: "80345-1",
    aggregation: "latest"
  },
  {
    code: "activity_level",
    display: "Activity level",
    description: "A general activity score generated by a fitness tracker or app; its calculation is device-specific and not standardized.",
    category: "activity",
    kind: "interval",
    canonicalUnit: "score",
    aliases: ["activity_level", "activity level"],
    aggregation: "average"
  },
  {
    code: "active_energy_burned",
    display: "Active energy burned",
    description: "The estimated number of calories burned through movement and physical activity, excluding calories burned at rest.",
    category: "activity",
    kind: "interval",
    canonicalUnit: "kcal",
    aliases: ["active energy", "active calories", "calories burned", "calorie burned"],
    openMHealthSchema: "calorie-burned",
    aggregation: "sum"
  },
  {
    code: "total_calories_burned",
    display: "Total calories burned",
    description: "The estimated total number of calories burned, combining resting energy use and physical activity.",
    category: "activity",
    kind: "interval",
    canonicalUnit: "kcal",
    aliases: ["total calories", "total energy burned", "total calorie burn"],
    loincCode: "41981-2",
    openMHealthSchema: "calorie-burned",
    aggregation: "sum"
  },
  {
    code: "activity_sessions",
    display: "Activity sessions",
    description: "A record of an individual exercise or activity session and how long it lasted.",
    category: "activity",
    kind: "event",
    canonicalUnit: "min",
    aliases: ["activity session", "exercise session", "exercise sessions"],
    aggregation: "sum"
  },
  {
    code: "distance",
    display: "Distance",
    description: "The total distance covered during an activity such as walking, running, or cycling.",
    category: "activity",
    kind: "interval",
    canonicalUnit: "m",
    aliases: ["distance", "distance travelled", "distance traveled"],
    loincCode: "41953-1",
    aggregation: "sum"
  },
  {
    code: "physical_activity_duration",
    display: "Physical activity duration",
    description: "The total amount of time spent doing physical activity.",
    category: "activity",
    kind: "interval",
    canonicalUnit: "min",
    aliases: ["physical activity", "activity duration", "exercise duration"],
    loincCode: "55411-3",
    openMHealthSchema: "physical-activity",
    aggregation: "sum"
  },
  {
    code: "exercise_speed",
    display: "Exercise speed",
    description: "The speed at which you were moving during an exercise session.",
    category: "activity",
    kind: "point",
    canonicalUnit: "m/s",
    aliases: ["speed", "exercise_speed", "exercise speed"],
    aggregation: "average"
  },
  {
    code: "hba1c",
    display: "HbA1c (Haemoglobin A1c)",
    description: "A blood test that reflects your average blood sugar level over roughly the past two to three months.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mmol/mol",
    aliases: ["hba1c", "hemoglobin a1c", "haemoglobin a1c", "a1c"],
    loincCode: "59261-8",
    normalHigh: 41,
    aggregation: "latest"
  },
    {
    code: "hba1c_pct",
    display: "HbA1c (Haemoglobin A1c) %",
    description: "A blood test that reflects your average blood sugar level over roughly the past two to three months, expressed as a percentage.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "%",
    aliases: ["hemoglobin a1c %", "haemoglobin a1c %", "hba1c %"],
    loincCode: "4548-4",
    aggregation: "latest"
  },
  {
    code: "glucose",
    display: "Glucose",
    description: "The level of sugar, or glucose, circulating in your blood at the time of testing.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mmol/L",
    aliases: ["glucose", "blood glucose", "fasting glucose"],
    loincCode: "14749-6",
    openMHealthSchema: "blood-glucose",
    normalLow: 3.9,
    normalHigh: 5.5,
    aggregation: "latest"
  },
  {
    code: "total_cholesterol",
    display: "Total cholesterol",
    description: "A blood test measuring the total amount of cholesterol carried in your blood.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mmol/L",
    aliases: ["total cholesterol", "cholesterol total", "cholesterol"],
    loincCode: "35200-5",
    normalHigh: 5.2,
    aggregation: "latest"
  },
  {
    code: "non_hdl_cholesterol",
    display: "Non-HDL cholesterol",
    description: "A blood test measuring cholesterol carried by all particles other than HDL, including LDL and VLDL.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mmol/L",
    aliases: ["non hdl cholesterol", "non-hdl cholesterol", "non hdl", "non-hdl", "non hdlc"],
    loincCode: "70204-3",
    aggregation: "latest"
  },
  {
    code: "hdl_cholesterol",
    display: "HDL cholesterol",
    description: "A blood test measuring high-density lipoprotein cholesterol, one type of cholesterol-carrying particle in your blood.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mmol/L",
    aliases: ["hdl", "hdl cholesterol"],
    loincCode: "22748-8",
    normalLow: 1,
    aggregation: "latest"
  },
  {
    code: "ldl_cholesterol",
    display: "LDL cholesterol",
    description: "A blood test measuring low-density lipoprotein cholesterol, one type of cholesterol-carrying particle in your blood.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mmol/L",
    aliases: ["ldl", "ldl cholesterol"],
    loincCode: "39469-2",
    normalHigh: 3,
    aggregation: "latest"
  },
  {
    code: "triglycerides",
    display: "Triglycerides",
    description: "A blood test measuring triglycerides, a type of fat in your blood.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mmol/L",
    aliases: ["triglycerides", "tg"],
    loincCode: "14771-0",
    normalHigh: 1.7,
    aggregation: "latest"
  },
  {
    code: "albumin",
    display: "Albumin",
    description: "A blood test measuring albumin, a protein made by the liver that carries substances and helps keep fluid inside blood vessels.",
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
    display: "ALP (Alkaline phosphatase)",
    description: "A blood test measuring alkaline phosphatase, an enzyme found mainly in the liver and bones.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "U/L",
    aliases: ["alkaline phosphatase", "alkaline phosphatase total", "alp", "alk phos"],
    loincCode: "6768-6",
    aggregation: "latest"
  },
  {
    code: "alanine_aminotransferase",
    display: "ALT (Alanine aminotransferase)",
    description: "A blood test measuring alanine aminotransferase, an enzyme found mainly in the liver.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "U/L",
    aliases: ["alanine aminotransferase", "alt", "sgpt"],
    loincCode: "1742-6",
    aggregation: "latest"
  },
  {
    code: "aspartate_aminotransferase",
    display: "AST (Aspartate aminotransferase)",
    description: "A blood test measuring aspartate aminotransferase, an enzyme found in the liver and other tissues such as muscle.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "U/L",
    aliases: ["aspartate aminotransferase", "ast", "sgot", "ast aspartate aminotransferase"],
    loincCode: "1920-8",
    aggregation: "latest"
  },
  {
    code: "bilirubin_total",
    display: "Total bilirubin",
    description: "A blood test measuring bilirubin, a substance produced when red blood cells break down and processed by the liver.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "µmol/L",
    aliases: ["total bilirubin", "bilirubin"],
    loincCode: "14631-6",
    aggregation: "latest"
  },
  {
    code: "bilirubin_direct",
    display: "Direct bilirubin",
    description: "A blood test measuring conjugated bilirubin, the form of bilirubin processed by the liver.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "µmol/L",
    aliases: ["direct bilirubin", "conjugated bilirubin", "bilirubin direct"],
    loincCode: "14629-0",
    aggregation: "latest"
  },
  {
    code: "calcium",
    display: "Calcium",
    description: "A blood test measuring calcium, a mineral important for bones, muscles, and nerves.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mmol/L",
    aliases: ["calcium", "serum calcium"],
    loincCode: "2000-8",
    normalLow: 2.1,
    normalHigh: 2.6,
    aggregation: "latest"
  },
  {
    code: "chloride",
    display: "Chloride",
    description: "A blood test measuring chloride, an electrolyte that helps maintain fluid balance in your body.",
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
    code: "bicarbonate",
    display: "Bicarbonate",
    description: "A blood test measuring bicarbonate, an electrolyte that helps maintain your body's acid-base balance.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mmol/L",
    aliases: ["bicarbonate", "serum bicarbonate"],
    loincCode: "1960-4",
    aggregation: "latest"
  },
  {
    code: "anion_gap",
    display: "Anion gap",
    description: "A calculated blood test value that helps assess the balance of charged particles and acid-base status in your blood.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mmol/L",
    aliases: ["anion gap", "serum anion gap", "ag"],
    loincCode: "10466-1",
    aggregation: "latest"
  },
  {
    code: "creatinine",
    display: "Creatinine",
    description: "A blood test measuring creatinine, a waste product from muscle activity that is filtered out by the kidneys.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "µmol/L",
    aliases: ["creatinine", "serum creatinine"],
    loincCode: "14682-9",
    aggregation: "latest"
  },
  {
    code: "urea",
    display: "Urea",
    description: "A blood test measuring urea, a waste product formed from protein breakdown and removed by the kidneys.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mmol/L",
    aliases: ["urea", "blood urea nitrogen", "bun", "urea nitrogen"],
    loincCode: "6299-2",
    aggregation: "latest"
  },
  {
    code: "ferritin",
    display: "Ferritin",
    description: "A blood test measuring ferritin, a protein that stores iron in your body.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "µg/L",
    aliases: ["ferritin", "serum ferritin"],
    loincCode: "2276-4",
    aggregation: "latest"
  },
  {
    code: "gamma_glutamyl_transferase",
    display: "GGT (Gamma-glutamyl transferase)",
    description: "A blood test measuring gamma-glutamyl transferase, an enzyme found mainly in the liver.",
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
    description: "A blood test measuring the level of iron circulating in your blood.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "µmol/L",
    aliases: ["iron", "serum iron", "fe++"],
    loincCode: "14801-5",
    normalLow: 9,
    normalHigh: 31,
    aggregation: "latest"
  },
  {
    code: "potassium",
    display: "Potassium",
    description: "A blood test measuring potassium, an electrolyte important for muscle and nerve function.",
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
    description: "A blood test measuring sodium, an electrolyte that helps control fluid balance in your body.",
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
    description: "A blood test measuring the total amount of protein, including albumin, in your blood.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "g/L",
    aliases: ["total protein", "serum total protein", "protein total"],
    loincCode: "2885-2",
    normalLow: 60,
    normalHigh: 80,
    aggregation: "latest"
  },
  {
    code: "thyroid_stimulating_hormone",
    display: "TSH (Thyroid-stimulating hormone)",
    description: "A blood test measuring a pituitary hormone that signals your thyroid to release thyroid hormones.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mIU/L",
    aliases: ["thyroid stimulating hormone", "tsh"],
    loincCode: "3016-3",
    aggregation: "latest"
  },
  {
    code: "thyroglobulin_antibodies",
    display: "Thyroglobulin antibodies",
    description: "A blood test measuring antibodies against thyroglobulin, which can help assess autoimmune thyroid disease.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "IU/mL",
    aliases: ["thyroglobulin antibodies", "thyroglobulin antibody", "anti thyroglobulin", "anti-thyroglobulin", "tgab"],
    loincCode: "8098-6",
    aggregation: "latest"
  },
  {
    code: "uric_acid",
    display: "Uric acid",
    description: "A blood test measuring uric acid, a waste product formed when your body breaks down purines from foods and cells.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "µmol/L",
    aliases: ["uric acid", "urate"],
    loincCode: "14933-6",
    aggregation: "latest"
  },
  {
    code: "vitamin_b12",
    display: "Vitamin B12",
    description: "A blood test measuring vitamin B12, a nutrient needed to make red blood cells and support nerve function.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "pmol/L",
    aliases: ["vitamin b12", "b12", "cobalamin"],
    loincCode: "14685-2",
    aggregation: "latest"
  },
  {
    code: "vitamin_d",
    display: "Vitamin D",
    description: "A blood test measuring vitamin D, a nutrient that helps your body absorb calcium.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "nmol/L",
    aliases: ["vitamin d", "25 hydroxy vitamin d", "25-oh vitamin d", "25(oh)d"],
    loincCode: "1989-3",
    aggregation: "latest"
  },
  {
    code: "high_sensitivity_c_reactive_protein",
    display: "High Sensitivity CRP (C-reactive protein)",
    description: "A sensitive blood test measuring C-reactive protein, a substance that rises when there is inflammation in your body.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mg/L",
    aliases: ["high sensitivity c reactive protein", "hs crp", "hs-crp"],
    loincCode: "30522-7",
    aggregation: "latest"
  },
  {
    code: "c_reactive_protein",
    display: "CRP (C-reactive protein)",
    description: "A blood test measuring C-reactive protein, a substance that rises when there is inflammation in your body.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mg/L",
    aliases: ["c reactive protein", "c-reactive protein", "crp"],
    loincCode: "1988-5",
    aggregation: "latest"
  },
  {
    code: "white_blood_cell_count",
    display: "White blood cell count",
    description: "A blood test measuring the number of white blood cells, which are part of your immune system.",
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
    description: "A blood test measuring the number of red blood cells, which carry oxygen around your body.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "×10¹²/L",
    aliases: ["red blood cell count", "red blood cells", "rbc", "red cell count"],
    loincCode: "789-8",
    aggregation: "latest"
  },
  {
    code: "haemoglobin",
    display: "Haemoglobin",
    description: "A blood test measuring haemoglobin, the protein in red blood cells that carries oxygen.",
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
    description: "A blood test measuring the proportion of your blood that is made up of red blood cells.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "L/L",
    aliases: ["haematocrit", "hematocrit", "hct"],
    loincCode: "4544-3",
    aggregation: "latest"
  },
  {
    code: "haematocrit_percentage",
    display: "Haematocrit %",
    description: "A calculated blood test measuring the percentage of your blood volume that is made up of red blood cells.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "%",
    aliases: ["haematocrit percentage", "haematocrit %", "hematocrit percentage", "hematocrit %", "calculated hematocrit"],
    loincCode: "20570-8",
    aggregation: "latest"
  },
  {
    code: "mean_corpuscular_volume",
    display: "MCV (Mean corpuscular volume)",
    description: "A blood test measuring the average size of your red blood cells.",
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
    display: "MCH (Mean corpuscular haemoglobin)",
    description: "A blood test measuring the average amount of haemoglobin inside each red blood cell.",
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
    display: "MCHC (Mean corpuscular haemoglobin concentration)",
    description: "A blood test measuring the average concentration of haemoglobin within your red blood cells.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "g/L",
    aliases: ["mean corpuscular haemoglobin concentration", "mean corpuscular hemoglobin concentration", "mchc"],
    loincCode: "786-4",
    aggregation: "latest"
  },
  {
    code: "red_cell_distribution_width",
    display: "RDW (Red cell distribution width)",
    description: "A blood test measuring how much variation there is in the size of your red blood cells.",
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
    description: "A blood test measuring the number of platelets, the cell fragments that help your blood clot.",
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
    description: "A blood test measuring the proportion of your white blood cells that are lymphocytes, a type of immune cell.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "%",
    aliases: ["lymphocyte percentage", "lymphocyte %", "lymphocytes %", "lymph %"],
    loincCode: "736-9",
    aggregation: "latest"
  },
  {
    code: "apolipoprotein_b",
    display: "Apolipoprotein B",
    description: "A blood test measuring apolipoprotein B, a protein found on LDL and other cholesterol-carrying particles.",
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
    description: "A blood test measuring lipoprotein(a), a cholesterol-carrying particle whose level is largely determined by genetics.",
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
    description: "A blood test measuring insulin, a hormone made by your pancreas that helps regulate blood sugar.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "pmol/L",
    aliases: ["insulin", "fasting insulin"],
    loincCode: "14796-7",
    aggregation: "latest"
  },
  {
    code: "estimated_glomerular_filtration_rate",
    display: "eGFR (Estimated glomerular filtration rate)",
    description: "An estimate, calculated from blood creatinine and other factors, of how well your kidneys filter waste from your blood.",
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
    description: "A blood test measuring the total amount of iron that iron-carrying proteins in your blood can hold.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "µmol/L",
    aliases: ["total iron binding capacity", "tibc"],
    loincCode: "14800-7",
    aggregation: "latest"
  },
  {
    code: "unsaturated_iron_binding_capacity",
    display: "Unsaturated iron-binding capacity",
    description: "A blood test measuring the unused capacity of transferrin to bind iron.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "µmol/L",
    aliases: ["unsaturated iron binding capacity", "uibc"],
    loincCode: "22753-8",
    aggregation: "latest"
  },
  {
    code: "transferrin",
    display: "Transferrin",
    description: "A blood test measuring transferrin, the protein that carries iron through your bloodstream.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "g/L",
    aliases: ["transferrin", "serum transferrin"],
    loincCode: "98996-2",
    aggregation: "latest"
  },
  {
    code: "transferrin_saturation",
    display: "Transferrin saturation",
    description: "A calculated value showing what percentage of the iron-carrying protein transferrin is carrying iron.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "%",
    aliases: ["transferrin saturation", "iron saturation", "tsat", "transferrin saturation %sat"],
    loincCode: "2502-3",
    aggregation: "latest"
  },
  {
    code: "neutrophil_percentage",
    display: "Neutrophils %",
    description: "A blood test measuring the proportion of your white blood cells that are neutrophils, a type of immune cell.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "%",
    aliases: ["neutrophil percentage", "neutrophils %", "neutrophil %", "neut %"],
    loincCode: "770-8",
    aggregation: "latest"
  },
  {
    code: "neutrophil_count",
    display: "Neutrophil count",
    description: "A blood test measuring the number of neutrophils, a type of white blood cell that helps fight infection.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "×10⁹/L",
    aliases: ["neutrophils", "neutrophil count", "absolute neutrophil count", "anc"],
    loincCode: "751-8",
    aggregation: "latest"
  },
  {
    code: "monocyte_count",
    display: "Monocyte count",
    description: "A blood test measuring the number of monocytes, a type of white blood cell involved in immune response.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "×10⁹/L",
    aliases: ["monocytes", "monocyte count", "absolute monocyte count"],
    loincCode: "742-7",
    aggregation: "latest"
  },
  {
    code: "lymphocyte_count",
    display: "Lymphocyte count",
    description: "A blood test measuring the number of lymphocytes, white blood cells that support immune defenses.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "×10⁹/L",
    aliases: ["lymphocytes", "lymphocyte count", "absolute lymphocyte count", "alc"],
    loincCode: "731-0",
    aggregation: "latest"
  },
  {
    code: "eosinophil_count",
    display: "Eosinophil count",
    description: "A blood test measuring the number of eosinophils, white blood cells involved in allergic and parasite responses.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "×10⁹/L",
    aliases: ["eosinophils", "eosinophil count", "absolute eosinophil count"],
    loincCode: "711-2",
    aggregation: "latest"
  },
  {
    code: "basophil_count",
    display: "Basophil count",
    description: "A blood test measuring the number of basophils, a type of white blood cell involved in inflammatory and allergic responses.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "×10⁹/L",
    aliases: ["basophils", "basophil count", "absolute basophil count"],
    loincCode: "26444-0",
    aggregation: "latest"
  },
  {
    code: "monocyte_percentage",
    display: "Monocytes %",
    description: "A blood test measuring the proportion of your white blood cells that are monocytes.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "%",
    aliases: ["monocyte percentage", "monocytes %", "monocyte %", "mono %"],
    loincCode: "5905-5",
    aggregation: "latest"
  },
  {
    code: "eosinophil_percentage",
    display: "Eosinophils %",
    description: "A blood test measuring the proportion of your white blood cells that are eosinophils.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "%",
    aliases: ["eosinophil percentage", "eosinophils %", "eosinophil %", "eos %"],
    loincCode: "713-8",
    aggregation: "latest"
  },
  {
    code: "basophil_percentage",
    display: "Basophils %",
    description: "A blood test measuring the proportion of your white blood cells that are basophils.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "%",
    aliases: ["basophil percentage", "basophils %", "basophil %", "baso %"],
    loincCode: "706-2",
    aggregation: "latest"
  },
  {
    code: "folate",
    display: "Folate",
    description: "A blood test measuring folate, or vitamin B9, a nutrient needed to make new cells.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "nmol/L",
    aliases: ["folate", "folic acid"],
    loincCode: "14732-2",
    aggregation: "latest"
  },
  {
    code: "magnesium",
    display: "Magnesium",
    description: "A blood test measuring magnesium, a mineral involved in muscle, nerve, and bone function.",
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
    description: "A blood test measuring phosphate, a mineral that works with calcium in your bones and cells.",
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
    code: "total_co2",
    display: "Total CO2",
    description: "A blood test measuring total carbon dioxide, which mainly reflects the bicarbonate level in your blood.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "mmol/L",
    aliases: ["total co2", "total carbon dioxide", "serum total carbon dioxide"],
    loincCode: "2028-9",
    aggregation: "latest"
  },
  {
    code: "testosterone_total",
    display: "Total testosterone",
    description: "A blood test measuring the total amount of testosterone in your blood.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "nmol/L",
    aliases: ["total testosterone", "testosterone", "testosterone total"],
    loincCode: "14913-8",
    aggregation: "latest"
  },
  {
    code: "sex_hormone_binding_globulin",
    display: "Sex hormone-binding globulin",
    description: "A blood test measuring sex hormone-binding globulin, a protein that carries hormones such as testosterone through your blood.",
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
    description: "A blood test measuring testosterone that is not bound to proteins and is available for your body to use.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "pmol/L",
    aliases: ["free testosterone"],
    loincCode: "2990-0",
    aggregation: "latest"
  },
  {
    code: "dehydroepiandrosterone_sulfate",
    display: "DHEAS (Dehydroepiandrosterone sulfate)",
    description: "A blood test measuring DHEA-S, a hormone produced mainly by your adrenal glands.",
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
    description: "A blood test measuring cortisol, a hormone involved in your body's stress response and metabolism.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "nmol/L",
    aliases: ["cortisol"],
    loincCode: "2130-3",
    aggregation: "latest"
  },
  {
    code: "progesterone",
    display: "Progesterone",
    description: "A blood test measuring progesterone, a hormone involved in the menstrual cycle and pregnancy.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "ng/mL",
    aliases: ["progesterone", "serum progesterone"],
    loincCode: "14890-8",
    aggregation: "latest"
  },
  {
    code: "free_thyroxine",
    display: "Free thyroxine",
    description: "A blood test measuring thyroxine, or T4, that is freely available in your blood.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "pmol/L",
    aliases: ["free thyroxine", "free t4", "ft4"],
    loincCode: "3026-2",
    aggregation: "latest"
  },
  {
    code: "free_triiodothyronine",
    display: "Free triiodothyronine",
    description: "A blood test measuring triiodothyronine, or T3, that is freely available in your blood.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "pmol/L",
    aliases: ["free triiodothyronine", "free t3", "ft3"],
    loincCode: "14928-6",
    aggregation: "latest"
  },
  {
    code: "insulin_like_growth_factor_1",
    display: "Insulin-like growth factor 1",
    description: "A blood test measuring IGF-1, a hormone that reflects growth hormone activity in your body.",
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
    description: "A blood test measuring homocysteine, an amino acid produced during your body's normal breakdown of protein.",
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
    description: "The combined percentage of the omega-3 fatty acids EPA and DHA in your red blood cell membranes.",
    category: "lab",
    kind: "panel-component",
    canonicalUnit: "%",
    aliases: ["omega 3 index", "omega-3 index", "epa dha index"],
    loincCode: "88998-0",
    aggregation: "latest"
  },
  {
    code: "rr_interval",
    display: "RR interval",
    description: "The time between two consecutive heartbeats, measured by an ECG or similar heart-rhythm sensor.",
    category: "cardio",
    kind: "point",
    canonicalUnit: "ms",
    aliases: ["rr interval", "r-r interval"],
    loincCode: "86334-3",
    openMHealthSchema: "rr-interval",
    aggregation: "average"
  },
  {
    code: "expiratory_time",
    display: "Expiratory time",
    description: "The length of time it takes you to breathe out during one breath.",
    category: "cardio",
    kind: "point",
    canonicalUnit: "sec",
    aliases: ["expiratory time", "forced expiratory time"],
    loincCode: "65819-5",
    openMHealthSchema: "expiratory-time",
    aggregation: "average"
  },
  {
    code: "forced_expiratory_volume_1",
    display: "Forced expiratory volume in one second",
    description: "The amount of air you can forcefully blow out in the first second of a spirometry breathing test.",
    category: "cardio",
    kind: "point",
    canonicalUnit: "L",
    aliases: ["forced expiratory volume 1", "fev1", "fev 1"],
    loincCode: "20150-9",
    aggregation: "latest"
  },
  {
    code: "forced_vital_capacity",
    display: "FVC (Forced vital capacity)",
    description: "The total amount of air you can forcefully blow out after taking as deep a breath as possible.",
    category: "cardio",
    kind: "point",
    canonicalUnit: "L",
    aliases: ["forced vital capacity", "fvc"],
    loincCode: "20157-4",
    aggregation: "latest"
  },
  {
    code: "fev1_fvc_ratio",
    display: "FEV1/FVC ratio",
    description: "The proportion of your total forced vital capacity that you can exhale in the first second of a spirometry test.",
    category: "cardio",
    kind: "point",
    canonicalUnit: "dimensionless",
    aliases: ["fev1 fvc ratio", "fev1/fvc"],
    loincCode: "19926-5",
    aggregation: "latest"
  },
  {
    code: "grip_strength",
    display: "Grip strength",
    description: "The amount of force your hand can generate when squeezing, usually measured with a handheld dynamometer.",
    category: "body",
    kind: "point",
    canonicalUnit: "kg",
    aliases: ["grip strength", "hand grip strength"],
    loincCode: "88643-4",
    aggregation: "latest"
  },
  {
    code: "vo2_max",
    display: "VO2 max",
    description: "The maximum amount of oxygen your body can use during intense exercise, a common measure of cardiorespiratory fitness.",
    category: "cardio",
    kind: "point",
    canonicalUnit: "mL/kg/min",
    aliases: ["vo2 max", "vo2max", "vo2 peak"],
    loincCode: "19245-1",
    aggregation: "latest"
  },
  {
    code: "gait_speed",
    display: "Gait speed",
    description: "How fast you walk over a short, measured distance.",
    category: "activity",
    kind: "point",
    canonicalUnit: "m/s",
    aliases: ["gait speed", "walking speed"],
    loincCode: "89467-3",
    aggregation: "latest"
  },
  {
    code: "reaction_time",
    display: "Reaction time",
    description: "The amount of time it takes you to respond to a stimulus, such as a sound or light; the result depends on the test used.",
    category: "derived",
    kind: "point",
    canonicalUnit: "ms",
    aliases: ["reaction time"],
    aggregation: "latest"
  }
];

const normalRangeSources: Readonly<Record<string, string>> = {
  respiratory_rate: "Royal College of Physicians, National Early Warning Score (NEWS2), 2017",
  potassium: "Tietz Fundamentals of Clinical Chemistry and Molecular Diagnostics, 8th ed.",
  sodium: "Spasovski et al., European Clinical Practice Guideline on Hyponatraemia, 2014"
};

export const defaultMeasurementTypes: MeasurementType[] = Object.freeze(
  measurementTypeDefinitions.map((definition) => {
    // `unitAliasesFor` reads `preferredUnits.imperial`, so the units have to be resolved first.
    const withUnits: MeasurementType = { ...definition, preferredUnits: preferredUnitsFor(definition) };
    const referenceRange = referenceRangeFor(withUnits);
    return Object.freeze({
      ...withUnits,
      unitAliases: unitAliasesFor(withUnits),
      ...(referenceRange === undefined ? {} : { referenceRanges: [Object.freeze(referenceRange)] })
    });
  })
) as MeasurementType[];

function referenceRangeFor(type: MeasurementType): ReferenceRange | undefined {
  if (type.normalLow === undefined && type.normalHigh === undefined) return undefined;
  return {
    ...(type.normalLow === undefined ? {} : { low: type.normalLow }),
    ...(type.normalHigh === undefined ? {} : { high: type.normalHigh }),
    unit: type.canonicalUnit,
    ...(normalRangeSources[type.code] === undefined ? {} : { source: normalRangeSources[type.code] })
  };
}

export const MANUAL_LAB_MARKER_CATALOG = defaultMeasurementTypes
  .filter((type) => type.category === "lab")
  .map((type) => ({ marker: type.display, unit: type.canonicalUnit, measurementCode: type.code }));

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
      "g/dL": ["g/dl", "g / dl"],
      "g/L": ["g/l"],
      "IU/mL": ["iu/ml", "[IU]/mL", "units/mL"],
      "%": ["percent"],
      "beats/min": ["bpm", "beats per minute", "count/min"],
      "breaths/min": ["breaths per minute"],
      "kcal/day": ["kcal", "kcal/d", "cal/day"],
      "µg/L": ["ug/L", "mcg/L", "ng/mL"],
      "×10⁹/L": ["10^9/L", "10⁹/L", "x10^9/L", "10³/µL", "10^3/uL", "10³/uL", "10*3/uL", "K/uL"],
      "×10¹²/L": ["10^12/L", "10¹²/L", "x10^12/L", "10⁶/µL", "10^6/uL", "10*6/uL", "M/uL"],
      "U/L": ["IU/L"],
      "mIU/L": ["µIU/mL", "uIU/mL"],
      "kg/m2": ["kg/m²"],
      cm2: ["cm²"],
      "g/cm2": ["g/cm²"],
      "mL/min/1.73m2": ["mL/min/1.73m²", "mL/min/1.73 m2"],
      "L/L": ["l/l", "ratio"],
      min: ["minute", "minutes", "mins"],
      sec: ["s", "second", "seconds"],
      m: ["meter", "meters", "metre", "metres"],
      count: ["steps", "count/day"]
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
    if (type.code === "glucose" || type.code === "total_cholesterol" || type.code === "non_hdl_cholesterol" || type.code === "hdl_cholesterol" || type.code === "ldl_cholesterol" || type.code === "triglycerides" || type.code === "creatinine" || type.code === "uric_acid") return "mg/dL";
    if (type.code === "hba1c") return "%";
    if (type.code === "haemoglobin") return "g/dL";
    return undefined;
}
