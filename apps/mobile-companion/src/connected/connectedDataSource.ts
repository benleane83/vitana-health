import type { ReplicaIdentity } from "@vitana/shared";
import { createCompanionApi } from "../api";
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

/**
 * The mutation reached the PC but this phone could not refresh its local copy afterwards. It is
 * deliberately distinct from a failed write: retrying the write would duplicate the record, so the
 * UI has to say "saved, not yet visible here" rather than inviting a re-submit.
 */
export class ReplicaRefreshFailedError extends Error {
  constructor(cause: unknown) {
    super("Your change was saved on your PC, but this phone could not refresh its copy yet. Pull to refresh in a moment.");
    this.name = "ReplicaRefreshFailedError";
    this.cause = cause;
  }
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
  // Set when a write landed on the PC but the follow-up sync did not. Until it clears, every read
  // forces a sync, so the user is never shown a copy that is known to be behind their own change.
  let refreshPending = false;

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
      url: synchronizedConnection.url,
      serverInstanceId: result.identity.serverInstanceId,
      profileId: result.identity.profileId,
      pairingId: result.identity.pairingId,
      lastSyncAt: result.cachedAt ?? new Date().toISOString()
    });
    lastConnectionError = undefined;
    return repository;
  };

  const cachedRead = async <T>(read: (current: ConnectedReplicaRepository) => Promise<T>): Promise<T> => {
    if (refreshPending) {
      // Best effort: still serve the stale copy if the PC is unreachable, but never skip the attempt.
      await synchronizeConnectedReplica({ force: true }).catch(() => undefined);
    }
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
      refreshPending = false;
      return true;
    } catch (caught) {
      lastConnectionError = caught;
      throw caught;
    }
  };

  const liveMutation = async <T>(mutation: () => Promise<T>): Promise<T> => {
    const result = await mutation();
    // The write already landed on the PC. Letting the refresh failure propagate as-is reads to the
    // user as "the save failed", they re-submit, and now there are two records.
    refreshPending = true;
    try {
      await synchronizeConnectedReplica({ force: true });
    } catch (caught) {
      throw new ReplicaRefreshFailedError(caught);
    }
    return result;
  };

  return {
    ...live,
    bootstrap: () => cachedRead((current) => current.bootstrap()),
    analytics: () => cachedRead((current) => current.analytics()),
    summary: () => cachedRead((current) => current.summary()),
    calendarMonth: (query) => cachedRead((current) => current.calendarMonth(query)),
    journal: (query) => cachedRead((current) => current.journal(query)),
    bodyTrendTimeline: (query) => cachedRead((current) => current.bodyTrendTimeline(query)),
    healthDataDetail: (measurementCode: string, page?: DetailPage) =>
      cachedRead((current) => current.healthDataDetail(measurementCode, page)),
    observationGroup: async (id) => {
      const detail = await cachedRead((current) => current.observationGroup(id));
      if (!detail) throw new Error("Observation group not found.");
      return detail;
    },
    healthDataChartSeries: (measurementCode, options) =>
      cachedRead((current) => current.healthDataChartSeries(
        measurementCode,
        { range: options?.range ?? "all", mode: options?.mode ?? "auto" }
      )),
    listHealthEvents: (query) => cachedRead((current) => current.listHealthEvents(query)),
    listCareItems: (query) => cachedRead((current) => current.listCareItems(query)),
    listMedications: (query) => cachedRead((current) => current.listMedications(query)),
    importManualObservations: (payload) => liveMutation(() => live.importManualObservations(payload)),
    updateObservation: (id, input) => liveMutation(() => live.updateObservation(id, input)),
    deleteObservation: (id) => liveMutation(() => live.deleteObservation(id)),
    setPersonalReferenceRange: (measurementCode, input) =>
      liveMutation(() => live.setPersonalReferenceRange(measurementCode, input)),
    removePersonalReferenceRange: (measurementCode) =>
      liveMutation(() => live.removePersonalReferenceRange(measurementCode)),
    createHealthEvent: (payload) => liveMutation(() => live.createHealthEvent(payload)),
    updateHealthEvent: (id, payload) => liveMutation(() => live.updateHealthEvent(id, payload)),
    deleteHealthEvent: (id) => liveMutation(() => live.deleteHealthEvent(id)),
    createCareItem: (payload) => liveMutation(() => live.createCareItem(payload)),
    updateCareItem: (id, payload) => liveMutation(() => live.updateCareItem(id, payload)),
    completeCareItem: (id, payload) => liveMutation(() => live.completeCareItem(id, payload)),
    deleteCareItem: (id) => liveMutation(() => live.deleteCareItem(id)),
    createMedication: (payload) => liveMutation(() => live.createMedication(payload)),
    updateMedication: (id, payload) => liveMutation(() => live.updateMedication(id, payload)),
    deleteMedication: (id) => liveMutation(() => live.deleteMedication(id)),
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
