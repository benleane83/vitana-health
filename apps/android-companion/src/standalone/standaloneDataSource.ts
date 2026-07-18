import type {
  ManualObservationPayload,
  MobileDetailPage,
  MobileProfileRepository
} from "@local-fitness-advisor/shared";
import type { CompanionDataSource, CompanionMutationService } from "../companionDataSource";
import { createStandaloneRepository } from "./createStandaloneRepository";

export function createStandaloneDataSource(): CompanionDataSource & CompanionMutationService {
  const repository = createStandaloneRepository();
  const getRepository = (): Promise<MobileProfileRepository> => repository;
  return {
    bootstrap: async () => (await getRepository()).bootstrap(),
    analytics: async () => (await getRepository()).analytics(),
    summary: async () => (await getRepository()).summary(),
    healthDataDetail: async (measurementCode: string, page?: MobileDetailPage) =>
      (await getRepository()).healthDataDetail(measurementCode, page),
    importManualObservations: async (payload: ManualObservationPayload) =>
      (await getRepository()).importManualObservations(payload)
  };
}
