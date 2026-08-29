import type {
  ManualObservationPayload,
  MobileMigrationReceipt,
  MobileDetailPage
} from "@vitana/shared";
import type {
  CompanionDataSource,
  CompanionCareService,
  CompanionLifecycleService,
  CompanionMaintenanceService,
  CompanionMutationService,
  CompanionObservationMutationService
} from "../companionDataSource";
import {
  createStandaloneProfile,
  createStandaloneRepository,
  resetStandaloneStorage
} from "./createStandaloneRepository";
import type { LocalProfileRepository } from "./localRepository";

export interface StandaloneMigrationSource {
  createFreshDataset(): Promise<void>;
  deleteSelectedDataset(): Promise<void>;
  migrationManifest(): ReturnType<LocalProfileRepository["migrationManifest"]>;
  streamMigrationBatches(sessionId: string): ReturnType<LocalProfileRepository["streamMigrationBatches"]>;
  archiveAfterMigration(receipt: MobileMigrationReceipt, serverUrl: string): Promise<void>;
}

export function createStandaloneDataSource(): CompanionDataSource & CompanionCareService & CompanionMutationService & CompanionObservationMutationService & CompanionMaintenanceService & CompanionLifecycleService & StandaloneMigrationSource {
  let repository = createStandaloneRepository();
  const getRepository = (): Promise<LocalProfileRepository> => repository;
  return {
    bootstrap: async () => (await getRepository()).bootstrap(),
    analytics: async () => (await getRepository()).analytics(),
    summary: async () => (await getRepository()).summary(),
    bodyTrendTimeline: async (query) => (await getRepository()).bodyTrendTimeline(query),
    calendarMonth: async (query) => (await getRepository()).calendarMonth(query),
    journal: async (query) => ({ timezone: query.timezone, days: [] }),
    healthDataDetail: async (measurementCode: string, page?: MobileDetailPage) =>
      (await getRepository()).healthDataDetail(measurementCode, page),
    observationGroup: async (id) => {
      const detail = await (await getRepository()).observationGroup(id);
      if (!detail) throw new Error("Observation group not found.");
      return detail;
    },
    healthDataChartSeries: async (measurementCode, options) =>
      (await getRepository()).healthDataChartSeries(measurementCode, options),
    listHealthEvents: async (query) => (await repository).listHealthEvents(query),
    createHealthEvent: async (payload) => (await repository).createHealthEvent(payload),
    updateHealthEvent: async (id, payload) => (await repository).updateHealthEvent(id, payload),
    deleteHealthEvent: async (id) => (await repository).deleteHealthEvent(id),
    listCareItems: async (query) => (await repository).listCareItems(query),
    createCareItem: async (payload) => (await repository).createCareItem(payload),
    updateCareItem: async (id, payload) => (await repository).updateCareItem(id, payload),
    completeCareItem: async (id, payload) => (await repository).completeCareItem(id, payload),
    deleteCareItem: async (id) => (await repository).deleteCareItem(id),
    listMedications: async (query) => (await repository).listMedications(query),
    createMedication: async (payload) => (await repository).createMedication(payload),
    updateMedication: async (id, payload) => (await repository).updateMedication(id, payload),
    deleteMedication: async (id) => (await repository).deleteMedication(id),
    updateObservation: async (id, input) => {
      const updated = await (await getRepository()).updateObservation(id, input);
      if (!updated) throw new Error("Observation not found.");
      return updated;
    },
    deleteObservation: async (id) => {
      const deleted = await (await getRepository()).deleteObservation(id);
      if (!deleted) throw new Error("Observation not found.");
      return deleted;
    },
    importManualObservations: async (payload: ManualObservationPayload) =>
      (await getRepository()).importManualObservations(payload),
    createFreshDataset: async () => (await repository).createFreshDataset(createStandaloneProfile()),
    deleteSelectedDataset: async () => (await repository).deleteSelectedDataset(),
    migrationManifest: async () => (await repository).migrationManifest(),
    streamMigrationBatches: async function* (sessionId) {
      yield* (await repository).streamMigrationBatches(sessionId);
    },
    archiveAfterMigration: async (receipt, serverUrl) =>
      (await repository).archiveAfterMigration(receipt, serverUrl),
    resetLocalData: async () => {
      await repository.then((current) => current.close()).catch(() => undefined);
      await resetStandaloneStorage();
      repository = createStandaloneRepository();
    },
    dispose: async () => {
      await repository.then((current) => current.close()).catch(() => undefined);
    }
  };
}
