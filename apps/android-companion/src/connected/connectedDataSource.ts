import { ApiError } from "@vitana/api-client";
import type { ReplicaIdentity } from "@vitana/shared";
import { createCompanionApi } from "../api";
import type { CompanionLifecycleService, DetailPage } from "../companionDataSource";
import { saveConnection, type ConnectionDetails } from "../endpointStore";
import { createConnectedStore } from "./createConnectedStore";
import { ConnectedReplicaRepository } from "./connectedRepository";
import { createReplicaNetwork, ReplicaClient } from "./replicaClient";
import { ReplicaSyncCoordinator } from "./syncCoordinator";

export interface ConnectedReplicaMaintenance {
  deleteConnectedReplica(): Promise<void>;
  connectionError(result: object): unknown;
}

export function createConnectedDataSource(
  connection: ConnectionDetails
): ReturnType<typeof createCompanionApi> & CompanionLifecycleService & ConnectedReplicaMaintenance {
  const live = createCompanionApi(connection);
  const storePromise = createConnectedStore();
  let repository: ConnectedReplicaRepository | undefined;
  let coordinator: ReplicaSyncCoordinator | undefined;
  const connectionErrors = new WeakMap<object, unknown>();
  const storedIdentity = connectionIdentity(connection);

  const localRepository = async () => {
    if (repository) return repository;
    if (!storedIdentity) {
      throw new Error("Connected data is unavailable offline until the first identity handshake and snapshot complete.");
    }
    repository = new ConnectedReplicaRepository(await storePromise, storedIdentity);
    return repository;
  };

  const synchronize = async () => {
    if (!coordinator) {
      coordinator = new ReplicaSyncCoordinator(
        new ReplicaClient(createReplicaNetwork(connection)),
        await storePromise,
        storedIdentity
      );
    }
    const result = await coordinator.synchronize();
    repository = new ConnectedReplicaRepository(await storePromise, result.identity);
    if (!storedIdentity) {
      await saveConnection({
        ...connection,
        serverInstanceId: result.identity.serverInstanceId,
        profileId: result.identity.profileId,
        pairingId: result.identity.pairingId,
        lastSyncAt: result.cachedAt ?? new Date().toISOString()
      });
    }
    return repository;
  };

  const liveThenCached = async <T>(
    liveRead: () => Promise<T>,
    cachedRead: (current: ConnectedReplicaRepository) => Promise<T>
  ): Promise<T> => {
    try {
      const result = await liveRead();
      void synchronize().catch(() => undefined);
      return result;
    } catch (liveError) {
      if (!canUseCachedData(liveError)) throw liveError;
      try {
        const result = await cachedRead(await localRepository());
        if (typeof result === "object" && result !== null) connectionErrors.set(result, liveError);
        return result;
      } catch {
        throw liveError;
      }
    }
  };

  return {
    ...live,
    bootstrap: () => liveThenCached(live.bootstrap, (current) => current.bootstrap()),
    analytics: () => liveThenCached(live.analytics, (current) => current.analytics()),
    summary: () => liveThenCached(live.summary, (current) => current.summary()),
    healthDataDetail: (measurementCode: string, page?: DetailPage) =>
      liveThenCached(
        () => live.healthDataDetail(measurementCode, page),
        (current) => current.healthDataDetail(measurementCode, page)
      ),
    connectionError: (result) => connectionErrors.get(result),
    deleteConnectedReplica: async () => {
      const identity = repository?.identity ?? storedIdentity;
      if (identity) await (await storePromise).deleteReplica(identity);
    },
    dispose: async () => {
      coordinator?.dispose();
      await storePromise.then((store) => store.close()).catch(() => undefined);
    }
  };
}

function canUseCachedData(error: unknown): boolean {
  if (error instanceof ApiError) return false;
  return !(error instanceof Error && error.name === "ZodError");
}

function connectionIdentity(connection: ConnectionDetails): ReplicaIdentity | undefined {
  return connection.serverInstanceId && connection.profileId && connection.pairingId
    ? {
        serverInstanceId: connection.serverInstanceId,
        profileId: connection.profileId,
        pairingId: connection.pairingId
      }
    : undefined;
}
