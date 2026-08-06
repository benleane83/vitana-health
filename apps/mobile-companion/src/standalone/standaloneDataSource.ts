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
  streamMigrationBatches(sessionId: string): ReturnType<LocalProfileRepository["streamMigrationBatches"]>;
  archiveAfterMigration(receipt: MobileMigrationReceipt, serverUrl: string): Promise<void>;
}

export function createStandaloneDataSource(): CompanionDataSource & CompanionMutationService & CompanionObservationMutationService & CompanionMaintenanceService & CompanionLifecycleService & StandaloneMigrationSource {
  let repository = createStandaloneRepository();
  const getRepository = (): Promise<MobileProfileRepository & Pick<LocalProfileRepository, "bodyTrendTimeline" | "calendarMonth" | "healthDataChartSeries">> => repository;
  return {
    bootstrap: async () => (await getRepository()).bootstrap(),
    analytics: async () => (await getRepository()).analytics(),
    summary: async () => (await getRepository()).summary(),
    bodyTrendTimeline: async (query) => (await getRepository()).bodyTrendTimeline(query),
    calendarMonth: async (query) => (await getRepository()).calendarMonth(query),
    journal: async (query) => ({ timezone: query.timezone, days: [] }),
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
