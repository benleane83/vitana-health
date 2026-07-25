import type { ReplicaIdentity } from "@vitana/shared";
import type { CompanionDataSource, CompanionLifecycleService, DetailPage } from "../companionDataSource";
import { saveConnection, type ConnectionDetails } from "../endpointStore";
import { createConnectedStore } from "./createConnectedStore";
import { ConnectedReplicaRepository } from "./connectedRepository";
import { createReplicaNetwork, ReplicaClient } from "./replicaClient";
import { ReplicaSyncCoordinator } from "./syncCoordinator";

export interface ConnectedReplicaMaintenance {
  deleteConnectedReplica(): Promise<void>;
}

export function createConnectedDataSource(
  connection: ConnectionDetails
): CompanionDataSource & CompanionLifecycleService & ConnectedReplicaMaintenance {
  const storePromise = createConnectedStore();
  let repository: ConnectedReplicaRepository | undefined;
  let coordinator: ReplicaSyncCoordinator | undefined;
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

  const syncThenRead = async <T>(read: (current: ConnectedReplicaRepository) => Promise<T>): Promise<T> => {
    try {
      return read(await synchronize());
    } catch (syncError) {
      try {
        return read(await localRepository());
      } catch {
        throw syncError;
      }
    }
  };

  return {
    bootstrap: () => syncThenRead((current) => current.bootstrap()),
    analytics: () => syncThenRead((current) => current.analytics()),
    summary: () => syncThenRead((current) => current.summary()),
    healthDataDetail: (measurementCode: string, page?: DetailPage) =>
      syncThenRead((current) => current.healthDataDetail(measurementCode, page)),
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

function connectionIdentity(connection: ConnectionDetails): ReplicaIdentity | undefined {
  return connection.serverInstanceId && connection.profileId && connection.pairingId
    ? {
        serverInstanceId: connection.serverInstanceId,
        profileId: connection.profileId,
        pairingId: connection.pairingId
      }
    : undefined;
}

