import type {
  ManualObservationPayload,
  MobileMigrationReceipt,
  MobileDetailPage,
  MobileProfileRepository
} from "@vitana/shared";
import type {
  CompanionDataSource,
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
  exportMigrationBatches(sessionId: string): ReturnType<LocalProfileRepository["exportMigrationBatches"]>;
  archiveAfterMigration(receipt: MobileMigrationReceipt, serverUrl: string): Promise<void>;
}

export function createStandaloneDataSource(): CompanionDataSource & CompanionMutationService & CompanionObservationMutationService & CompanionMaintenanceService & CompanionLifecycleService & StandaloneMigrationSource {
  let repository = createStandaloneRepository();
  const getRepository = (): Promise<MobileProfileRepository & Pick<LocalProfileRepository, "healthDataChartSeries">> => repository;
  return {
    bootstrap: async () => (await getRepository()).bootstrap(),
    analytics: async () => (await getRepository()).analytics(),
    summary: async () => (await getRepository()).summary(),
    healthDataDetail: async (measurementCode: string, page?: MobileDetailPage) =>
      (await getRepository()).healthDataDetail(measurementCode, page),
    healthDataChartSeries: async (measurementCode, options) =>
      (await getRepository()).healthDataChartSeries(measurementCode, options),
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
    exportMigrationBatches: async (sessionId) => (await repository).exportMigrationBatches(sessionId),
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
