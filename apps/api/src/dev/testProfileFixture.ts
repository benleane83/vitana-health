import {
  EXPORT_FORMAT_VERSION,
  careItemKindCodes,
  defaultMeasurementTypes,
  healthEventKindCodes,
  type ActivitySession,
  type CareItem,
  type HealthEvent,
  type HealthStoreData,
  type MeasurementType,
  type Observation,
  type ObservationGroup,
  type TimeSeriesSample
} from "@vitana/shared";

export const TEST_PROFILE_ID = "vitana-test-profile";
export const TEST_PROFILE_NAME = "Vitana Test Profile";
export const TEST_PROFILE_AS_OF = "2026-07-26T12:00:00.000Z";

const DAY_MS = 86_400_000;
const anomalyCodes = new Set([
  "heart_rate",
  "oxygen_saturation",
  "blood_pressure_systolic",
  "glucose",
  "ldl_cholesterol",
  "vitamin_d"
]);

const baselines: Record<string, number> = {
  weight: 74.5,
  height: 176,
  body_fat_pct: 21,
  skeletal_muscle_mass: 32,
  fat_mass: 15.6,
  lean_body_mass: 58.9,
  visceral_fat_level: 8,
  total_body_water: 43,
  body_water_pct: 57.5,
  basal_metabolic_rate: 1640,
  bone_mineral_content: 3.1,
  bone_mineral_density: 1.15,
  body_cell_mass: 37,
  intracellular_water: 26,
  extracellular_water: 17,
  extracellular_water_ratio: 0.395,
  visceral_fat_area: 78,
  subcutaneous_fat_mass: 12,
  waist_circumference: 84,
  hip_circumference: 98,
  waist_hip_ratio: 0.86,
  metabolic_age: 38,
  protein_mass: 11.5,
  basal_body_temperature: 36.5,
  skin_temperature: 33.2,
  hrv_sdnn: 52,
  hrv_rmssd: 39,
  activity_level: 65,
  active_energy_burned: 520,
  total_calories_burned: 2280,
  distance: 6800,
  physical_activity_duration: 48,
  exercise_speed: 2.4,
  alkaline_phosphatase: 72,
  alanine_aminotransferase: 24,
  aspartate_aminotransferase: 22,
  bilirubin_total: 11,
  creatinine: 82,
  urea: 5.1,
  ferritin: 95,
  gamma_glutamyl_transferase: 20,
  thyroid_stimulating_hormone: 2.1,
  uric_acid: 310,
  vitamin_b12: 410,
  vitamin_d: 78,
  high_sensitivity_c_reactive_protein: 0.9,
  red_blood_cell_count: 4.8,
  haemoglobin: 145,
  haematocrit: 0.44,
  mean_corpuscular_haemoglobin_concentration: 335,
  red_cell_distribution_width: 13,
  lymphocyte_percentage: 31,
  apolipoprotein_b: 0.85,
  lipoprotein_a: 32,
  insulin: 48,
  estimated_glomerular_filtration_rate: 96,
  total_iron_binding_capacity: 58,
  transferrin_saturation: 28,
  neutrophil_percentage: 56,
  folate: 24,
  magnesium: 0.86,
  testosterone_total: 18,
  sex_hormone_binding_globulin: 35,
  free_testosterone: 360,
  dehydroepiandrosterone_sulfate: 6.2,
  cortisol: 360,
  free_thyroxine: 16,
  free_triiodothyronine: 4.8,
  insulin_like_growth_factor_1: 20,
  homocysteine: 9,
  omega_3_index: 7.2,
  rr_interval: 860,
  expiratory_time: 2.3,
  forced_expiratory_volume_1: 3.7,
  forced_vital_capacity: 4.6,
  fev1_fvc_ratio: 0.8,
  grip_strength: 42,
  vo2_max: 43,
  gait_speed: 1.35,
  reaction_time: 245
};

export interface TestProfileFixtureOptions {
  asOf?: string;
}

export function createTestProfileFixture(options: TestProfileFixtureOptions = {}): HealthStoreData {
  const asOf = new Date(options.asOf ?? TEST_PROFILE_AS_OF);
  if (!Number.isFinite(asOf.getTime())) throw new Error("Test profile asOf must be a valid timestamp.");

  const observations: Observation[] = [];
  const timeSeriesSamples: TimeSeriesSample[] = [];
  const observationGroups: ObservationGroup[] = [];
  const activitySessions = createActivities(asOf);

  for (const type of defaultMeasurementTypes) {
    if (type.kind === "event") continue;
    if (type.kind === "interval") {
      createIntervalSamples(type, asOf, timeSeriesSamples);
      continue;
    }
    if (type.kind === "panel-component") continue;
    createPointObservations(type, asOf, observations);
  }
  createLabPanels(asOf, observations, observationGroups);

  const rowCount = observations.length + timeSeriesSamples.length + activitySessions.length;
  return {
    schemaVersion: EXPORT_FORMAT_VERSION,
    profile: {
      id: TEST_PROFILE_ID,
      displayName: TEST_PROFILE_NAME,
      setupStatus: "complete",
      subjectKind: "adult",
      birthDate: "1986-04-18",
      sex: "not-specified",
      heightCm: 176,
      bloodType: "o-positive",
      goalSummary: "Synthetic profile for testing dashboards, trends, reference ranges, care items, and health events.",
      cloudAiConsent: { enabled: false, providerScopeAccepted: false, consentVersion: "synthetic-fixture-v1" },
      units: "metric",
      updatedAt: asOf.toISOString()
    },
    sourceImports: [{
      id: "synthetic-import",
      sourceKind: "structured-upload",
      fileName: "vitana-synthetic-test-profile",
      importedAt: asOf.toISOString(),
      parserVersion: "test-profile-v1",
      checksum: "synthetic-deterministic-2026-07-26",
      rowCount,
      status: "processed",
      diagnostics: ["Generated synthetic data. Not suitable for clinical use."]
    }],
    dataSources: [{
      id: "synthetic-wearable",
      sourceKind: "health-connect",
      label: "Synthetic wearable",
      importId: "synthetic-import",
      createdAt: shiftDays(asOf, -180, 6).toISOString()
    }, {
      id: "synthetic-manual",
      sourceKind: "manual-entry",
      label: "Synthetic manual entries",
      importId: "synthetic-import",
      createdAt: shiftDays(asOf, -180, 6).toISOString()
    }, {
      id: "synthetic-lab",
      sourceKind: "blood-test-report",
      label: "Synthetic laboratory",
      importId: "synthetic-import",
      createdAt: shiftDays(asOf, -180, 6).toISOString()
    }],
    devices: [{
      id: "synthetic-watch",
      label: "Vitana Mock Watch",
      manufacturer: "Synthetic Devices",
      model: "Test Series 1",
      sourceId: "synthetic-wearable"
    }, {
      id: "synthetic-scale",
      label: "Vitana Mock Body Scale",
      manufacturer: "Synthetic Devices",
      model: "Body Test 1",
      sourceId: "synthetic-manual"
    }],
    measurementTypes: structuredClone(defaultMeasurementTypes),
    personalReferenceRanges: [],
    pinnedMeasurements: [],
    observations,
    observationGroups,
    timeSeriesSamples,
    measurementAggregates: [],
    activitySessions,
    healthEvents: createHealthEvents(asOf),
    careItems: createCareItems(asOf),
    insights: [],
    auditEvents: [{
      id: "audit-synthetic-profile-created",
      createdAt: asOf.toISOString(),
      eventType: "store-created",
      detail: `Created ${TEST_PROFILE_NAME} with ${rowCount} synthetic measurement records.`
    }]
  };
}

function createIntervalSamples(type: MeasurementType, asOf: Date, target: TimeSeriesSample[]): void {
  for (let day = 180; day >= 0; day -= 1) {
    const start = shiftDays(asOf, -day, type.code === "sleep_duration" ? -8 : 0);
    const end = new Date(start.getTime() + (type.code === "sleep_duration" ? 8 : 1) * 3_600_000);
    target.push({
      id: `sample-${type.code}-${day}`,
      measurementCode: type.code,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      value: generatedValue(type, day, day === 137),
      unit: type.canonicalUnit,
      sourceId: "synthetic-wearable",
      deviceId: "synthetic-watch",
      sourceJson: { synthetic: true }
    });
  }
}

function createPointObservations(type: MeasurementType, asOf: Date, target: Observation[]): void {
  const frequent = type.category === "cardio";
  const body = type.category === "body";
  const count = frequent ? 91 : body ? 27 : 13;
  const step = frequent ? 2 : body ? 7 : 14;
  for (let index = count - 1; index >= 0; index -= 1) {
    const daysAgo = Math.min(180, index * step);
    target.push({
      id: `observation-${type.code}-${index}`,
      measurementCode: type.code,
      observedAt: shiftDays(asOf, -daysAgo, type.category === "cardio" ? -4 : -2).toISOString(),
      value: generatedValue(type, index, index === count - 4),
      unit: type.canonicalUnit,
      sourceId: frequent ? "synthetic-wearable" : "synthetic-manual",
      ...(frequent ? { deviceId: "synthetic-watch" } : body ? { deviceId: "synthetic-scale" } : {}),
      ...(anomalyCodes.has(type.code) && index === count - 4 ? { note: "Synthetic out-of-range test value" } : {}),
      sourceJson: { synthetic: true }
    });
  }
}

function createLabPanels(asOf: Date, observations: Observation[], groups: ObservationGroup[]): void {
  const labs = defaultMeasurementTypes.filter((type) => type.kind === "panel-component");
  for (let panel = 5; panel >= 0; panel -= 1) {
    const collectedAt = shiftDays(asOf, -(panel * 30 + 3), -3);
    const groupId = `synthetic-lab-panel-${panel}`;
    groups.push({
      id: groupId,
      kind: "lab_panel",
      label: panel === 0 ? "Synthetic current health panel" : `Synthetic historical panel ${6 - panel}`,
      sourceId: "synthetic-lab",
      importId: "synthetic-import",
      collectedAt: collectedAt.toISOString(),
      metadata: { synthetic: true, fasting: panel % 2 === 0 }
    });
    for (const type of labs) {
      observations.push({
        id: `observation-${type.code}-panel-${panel}`,
        measurementCode: type.code,
        observedAt: collectedAt.toISOString(),
        value: generatedValue(type, panel, panel === 4),
        unit: type.canonicalUnit,
        sourceId: "synthetic-lab",
        observationGroupId: groupId,
        ...(anomalyCodes.has(type.code) && panel === 4 ? { note: "Synthetic out-of-range test value" } : {}),
        sourceJson: { synthetic: true, panel }
      });
    }
  }
}

function generatedValue(type: MeasurementType, index: number, anomalyCandidate: boolean): number {
  const low = type.normalLow;
  const high = type.normalHigh;
  let baseline = baselines[type.code] ?? fallbackBaseline(type);
  if (low !== undefined && high !== undefined) baseline = (low + high) / 2;
  else if (low !== undefined) baseline = low * 1.15;
  else if (high !== undefined) baseline = high * 0.78;

  if (anomalyCandidate && anomalyCodes.has(type.code)) {
    if (high !== undefined) return round(high + Math.max(Math.abs(high) * 0.18, 0.5));
    if (low !== undefined) return round(Math.max(0, low - Math.max(Math.abs(low) * 0.2, 0.5)));
  }
  const wave = Math.sin(index * 1.73 + type.code.length);
  if (low !== undefined && high !== undefined) {
    return round(baseline + wave * (high - low) * 0.12);
  }
  const variation = 1 + wave * 0.035;
  return round(Math.max(0, baseline * variation));
}

function fallbackBaseline(type: MeasurementType): number {
  const byUnit: Record<string, number> = {
    "%": 50,
    "kg": 25,
    "cm": 90,
    "L": 4,
    "mmol/L": 4.5,
    "µmol/L": 100,
    "nmol/L": 20,
    "pmol/L": 300,
    "g/L": 50,
    "mg/L": 1,
    "U/L": 25,
    "ms": 100,
    "min": 45,
    "sec": 2,
    "count": 8_000,
    "score": 65,
    "dimensionless": 0.8
  };
  return byUnit[type.canonicalUnit] ?? 10;
}

function createActivities(asOf: Date): ActivitySession[] {
  const activities: ActivitySession[] = [];
  const types = ["walking", "running", "cycling", "strength training"];
  for (let week = 25; week >= 0; week -= 1) {
    for (let session = 0; session < 3; session += 1) {
      const activityType = types[(week + session) % types.length]!;
      const durationMinutes = activityType === "strength training" ? 45 : 30 + ((week + session) % 4) * 10;
      const startAt = shiftDays(asOf, -(week * 7 + session * 2), -5);
      activities.push({
        id: `activity-${week}-${session}`,
        activityType,
        startAt: startAt.toISOString(),
        endAt: new Date(startAt.getTime() + durationMinutes * 60_000).toISOString(),
        durationMinutes,
        energyKcal: Math.round(durationMinutes * (activityType === "running" ? 9 : activityType === "cycling" ? 7 : 5)),
        ...(activityType === "strength training" ? {} : { distanceMeters: Math.round(durationMinutes * (activityType === "running" ? 165 : activityType === "cycling" ? 360 : 90)) }),
        sourceId: "synthetic-wearable",
        sourceJson: { synthetic: true }
      });
    }
  }
  return activities;
}

function createHealthEvents(asOf: Date): HealthEvent[] {
  return healthEventKindCodes.map((kind, index) => {
    const base = {
      id: `health-event-${kind}`,
      kind,
      status: index === healthEventKindCodes.length - 1 ? "entered-in-error" as const : "completed" as const,
      occurredAt: shiftDays(asOf, -(12 + index * 13), -2).toISOString(),
      source: "manual-entry" as const,
      ...(index % 3 === 0 ? { provider: "Vitana Test Clinic" } : {}),
      notes: `Synthetic ${kind} event for feature testing.`,
      metadata: { synthetic: true }
    };
    if (kind === "immunization") return {
      ...base,
      kind,
      immunization: { vaccine: "Seasonal influenza", targetDisease: "Influenza", doseNumber: 1, route: "intramuscular", site: "left arm" }
    };
    if (kind === "medication") return {
      ...base,
      kind,
      medicationAdministration: { medication: "Synthetic test medication", dose: 10, unit: "mg", route: "oral" }
    };
    return base as HealthEvent;
  });
}

function createCareItems(asOf: Date): CareItem[] {
  return careItemKindCodes.map((kind, index) => {
    const dueStart = new Date(Date.UTC(2026, 7 + Math.floor(index / 2), 8 + (index % 2) * 12, 9, 0));
    const reminderDays = index % 2 === 0 ? 7 : 1;
    return {
      id: `care-item-${kind}`,
      kind,
      title: `Synthetic ${kind.replaceAll("-", " ")}`,
      dueStart: dueStart.toISOString(),
      reminderAt: new Date(dueStart.getTime() - reminderDays * DAY_MS).toISOString(),
      priority: index % 4 === 0 ? "high" : index % 3 === 0 ? "low" : "normal",
      status: index === 8 || index === 9 ? "cancelled" : "open",
      scheduleProvenance: "synthetic-test-profile",
      scheduleVersion: "1",
      notes: `Future synthetic care item generated as of ${asOf.toISOString().slice(0, 10)}.`
    };
  });
}

function shiftDays(value: Date, days: number, hours = 0): Date {
  return new Date(value.getTime() + days * DAY_MS + hours * 3_600_000);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
