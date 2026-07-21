import type {
  ManualObservationPayload,
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
  createStandaloneRepository,
  resetStandaloneStorage
} from "./createStandaloneRepository";

export function createStandaloneDataSource(): CompanionDataSource & CompanionMutationService & CompanionObservationMutationService & CompanionMaintenanceService & CompanionLifecycleService {
  let repository = createStandaloneRepository();
  const getRepository = (): Promise<MobileProfileRepository> => repository;
  return {
    bootstrap: async () => (await getRepository()).bootstrap(),
    analytics: async () => (await getRepository()).analytics(),
    summary: async () => (await getRepository()).summary(),
    healthDataDetail: async (measurementCode: string, page?: MobileDetailPage) =>
      (await getRepository()).healthDataDetail(measurementCode, page),
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
