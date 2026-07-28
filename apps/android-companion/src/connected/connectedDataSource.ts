import type { ReplicaIdentity } from "@vitana/shared";
import { createCompanionApi } from "../api";
import { chartSeriesFromDetail } from "../chartSeries";
import type { CompanionLifecycleService, DetailPage } from "../companionDataSource";
import { saveConnection, type ConnectionDetails } from "../endpointStore";
import { LONG_RUNNING_PINNED_REQUEST_TIMEOUT_MS } from "../pinnedFetch";
import { createConnectedStore } from "./createConnectedStore";
import { ConnectedReplicaRepository } from "./connectedRepository";
import { createReplicaNetwork, ReplicaClient } from "./replicaClient";
import { ReplicaSyncCoordinator } from "./syncCoordinator";

export interface ConnectedReplicaMaintenance {
  prepareConnectedReplica(): Promise<ConnectionDetails>;
  synchronizeConnectedReplica(options?: { force?: boolean }): Promise<boolean>;
  deleteConnectedReplica(): Promise<void>;
  connectionError(result: object): unknown;
}

const REPLICA_STALE_AFTER_MS = 5 * 60 * 1_000;

/**
 * Holds the shared encrypted database open across a data-source swap. Switching operating modes
 * disposes the old source before the new one takes its lease, and letting the lease count reach
 * zero in between closes the handle - costing a full key derivation, cipher check and migration
 * scan on the very next read.
 */
export async function retainConnectedStore(): Promise<() => Promise<void>> {
  const store = await createConnectedStore();
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await store.close();
  };
}

export function createConnectedDataSource(
  connection: ConnectionDetails
): ReturnType<typeof createCompanionApi> & CompanionLifecycleService & ConnectedReplicaMaintenance {
  const live = createCompanionApi(connection, LONG_RUNNING_PINNED_REQUEST_TIMEOUT_MS);
  const storePromise = createConnectedStore();
  let repository: ConnectedReplicaRepository | undefined;
  let coordinator: ReplicaSyncCoordinator | undefined;
  let synchronizedConnection = connection;
  const connectionErrors = new WeakMap<object, unknown>();
  const storedIdentity = connectionIdentity(connection);
  let lastConnectionError: unknown;

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
        new ReplicaClient(createReplicaNetwork(connection, LONG_RUNNING_PINNED_REQUEST_TIMEOUT_MS)),
        await storePromise,
        storedIdentity
      );
    }
    const result = await coordinator.synchronize();
    repository = new ConnectedReplicaRepository(await storePromise, result.identity);
    synchronizedConnection = await saveConnection({
      ...synchronizedConnection,
      serverInstanceId: result.identity.serverInstanceId,
      profileId: result.identity.profileId,
      pairingId: result.identity.pairingId,
      lastSyncAt: result.cachedAt ?? new Date().toISOString()
    });
    lastConnectionError = undefined;
    return repository;
  };

  const cachedRead = async <T>(read: (current: ConnectedReplicaRepository) => Promise<T>): Promise<T> => {
    const result = await read(await localRepository());
    if (typeof result === "object" && result !== null && lastConnectionError) {
      connectionErrors.set(result, lastConnectionError);
    }
    return result;
  };

  const synchronizeConnectedReplica = async (options: { force?: boolean } = {}) => {
    try {
      if (!options.force && storedIdentity) {
        const metadata = await (await localRepository()).metadata();
        // `appliedAt` is written by this device. `cachedAt` comes from the PC, so a skewed PC clock
        // could otherwise keep the replica looking fresh forever.
        const appliedAt = metadata?.appliedAt ? new Date(metadata.appliedAt).getTime() : Number.NaN;
        if (Number.isFinite(appliedAt) && Date.now() - appliedAt < REPLICA_STALE_AFTER_MS) return false;
      }
      await synchronize();
      return true;
    } catch (caught) {
      lastConnectionError = caught;
      throw caught;
    }
  };

  const liveMutation = async <T>(mutation: () => Promise<T>): Promise<T> => {
    const result = await mutation();
    await synchronizeConnectedReplica({ force: true });
    return result;
  };

  return {
    ...live,
    bootstrap: () => cachedRead((current) => current.bootstrap()),
    analytics: () => cachedRead((current) => current.analytics()),
    summary: () => cachedRead((current) => current.summary()),
    healthDataDetail: (measurementCode: string, page?: DetailPage) =>
      cachedRead((current) => current.healthDataDetail(measurementCode, page)),
    healthDataChartSeries: (measurementCode, options) =>
      cachedRead(async (current) => chartSeriesFromDetail(
        await current.healthDataDetail(measurementCode),
        { range: options?.range ?? "all", mode: options?.mode ?? "auto" }
      )),
    listHealthEvents: (query) => cachedRead((current) => current.listHealthEvents(query)),
    listCareItems: (query) => cachedRead((current) => current.listCareItems(query)),
    importManualObservations: (payload) => liveMutation(() => live.importManualObservations(payload)),
    updateObservation: (id, input) => liveMutation(() => live.updateObservation(id, input)),
    deleteObservation: (id) => liveMutation(() => live.deleteObservation(id)),
    createHealthEvent: (payload) => liveMutation(() => live.createHealthEvent(payload)),
    updateHealthEvent: (id, payload) => liveMutation(() => live.updateHealthEvent(id, payload)),
    deleteHealthEvent: (id) => liveMutation(() => live.deleteHealthEvent(id)),
    createCareItem: (payload) => liveMutation(() => live.createCareItem(payload)),
    updateCareItem: (id, payload) => liveMutation(() => live.updateCareItem(id, payload)),
    completeCareItem: (id, payload) => liveMutation(() => live.completeCareItem(id, payload)),
    deleteCareItem: (id) => liveMutation(() => live.deleteCareItem(id)),
    connectionError: (result) => connectionErrors.get(result),
    prepareConnectedReplica: async () => {
      await synchronize();
      return synchronizedConnection;
    },
    synchronizeConnectedReplica,
    deleteConnectedReplica: async () => {
      await coordinator?.dispose();
      const identity = repository?.identity ?? storedIdentity;
      // Both are cleared: a disposed coordinator rejects every later synchronize() call, and the
      // repository would keep serving a projection of data we just deleted.
      coordinator = undefined;
      repository = undefined;
      if (identity) await (await storePromise).deleteReplica(identity);
    },
    dispose: async () => {
      await coordinator?.dispose();
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
