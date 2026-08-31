import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import type {
  AnalyticsSummary,
  AppBootstrap,
  BodyTrendQuery,
  BodyTrendTimeline,
  CalendarMonthData,
  CalendarMonthQuery,
  CareItemListQuery,
  CompleteCareItemInput,
  CreateCareItemInput,
  CreateHealthEventInput,
  HealthDataChartSeries,
  HealthDataChartSeriesOptions,
  HealthDataDetail,
  HealthDataSummary,
  HealthEventListQuery,
  JournalPage,
  JournalQueryInput,
  ManualObservationPayload,
  MedicationListQuery,
  MobileMigrationManifest,
  MobileMigrationReceipt,
  ObservationGroupDetail,
  ObservationGroupListItem,
  ObservationGroupListQuery,
  PaginatedResult,
  PersonalReferenceRangeInput,
  CreateMedicationInput,
  UpdateObservationInput
} from "@vitana/shared";
import { clearConnection, clearSelectedProfileId, loadConnection } from "./endpointStore";
import type { ConnectionDetails } from "./endpointStore";
import { createCompanionApi } from "./api";
import { connectionStateForError, type ConnectionState } from "./connectionState";
import type {
  CompanionCareService,
  CompanionDataSource,
  CompanionLifecycleService,
  CompanionMaintenanceService,
  CompanionReferenceRangeMutationService,
  DetailPage
} from "./companionDataSource";
import { createDemoDataSource } from "./demoDataSource";
import { loadDemoMode, saveDemoMode } from "./demoModeStore";
import {
  loadOperatingMode,
  resolveOperatingMode,
  saveOperatingMode,
  shouldCreateStandaloneSource,
  type CompanionOperatingMode
} from "./operatingModeStore";
import type { CompanionMutationService } from "./companionDataSource";
import type { CompanionObservationMutationService } from "./companionDataSource";
import { createStandaloneDataSource } from "./standalone/standaloneDataSource";
import { DEFAULT_MIGRATION_BATCH_SIZE } from "./standalone/localStore";
import { cacheProfilePhoto } from "./profilePhotoCache";
import { refreshConnectedProfilePhoto, type ConnectedProfilePhoto } from "./connectedProfilePhoto";
import {
  createConnectedDataSource,
  retainConnectedStore,
  type ConnectedReplicaMaintenance
} from "./connected/connectedDataSource";
import type { StandaloneMigrationSource } from "./standalone/standaloneDataSource";
import { userFacingError } from "./userFacingError";
import { queueConnectionRevocation, retryPendingRevocation } from "./pendingRevocation";
import { LONG_RUNNING_PINNED_REQUEST_TIMEOUT_MS } from "./pinnedFetch";
import { retryPinnedRequest } from "./retryPinnedRequest";

export type { ConnectionState } from "./connectionState";

interface MobileApiContextValue {
  connection: ConnectionDetails | null;
  connectionState: ConnectionState;
  demoMode: boolean;
  operatingMode: CompanionOperatingMode;
  standaloneMode: boolean;
  bootstrap?: AppBootstrap;
  analytics?: AnalyticsSummary;
  summary?: HealthDataSummary;
  profilePhotoUri?: string;
  dashboardLoading: boolean;
  trackLoading: boolean;
  syncing: boolean;
  error?: string;
  transientRevision: number;
  migrationProgress?: { uploaded: number; total: number };
  reloadConnection(options?: { preserveSession?: boolean }): Promise<void>;
  setDemoMode(enabled: boolean): Promise<void>;
  setOperatingMode(mode: CompanionOperatingMode): Promise<void>;
  standaloneMigrationManifest(): Promise<MobileMigrationManifest>;
  migrateStandaloneData(): Promise<MobileMigrationReceipt>;
  discardStandaloneDataAndConnect(): Promise<void>;
  cancelPendingConnection(): Promise<void>;
  refreshDashboard(options?: { synchronize?: boolean }): Promise<void>;
  refreshTrack(options?: { synchronize?: boolean }): Promise<void>;
  synchronizeConnectedData(force?: boolean): Promise<boolean>;
  bodyTrendTimeline(query: BodyTrendQuery, signal?: AbortSignal): Promise<BodyTrendTimeline>;
  calendarMonth(query: CalendarMonthQuery, signal?: AbortSignal): Promise<CalendarMonthData>;
  journal(query: JournalQueryInput, signal?: AbortSignal): Promise<JournalPage>;
  healthDataDetail(measurementCode: string, page?: DetailPage): Promise<HealthDataDetail>;
  observationGroup(id: string): Promise<ObservationGroupDetail>;
  listObservationGroups(query?: ObservationGroupListQuery): Promise<PaginatedResult<ObservationGroupListItem>>;
  healthDataChartSeries(measurementCode: string, options: HealthDataChartSeriesOptions): Promise<HealthDataChartSeries>;
  importManualObservations(payload: ManualObservationPayload): Promise<unknown>;
  updateObservation(id: string, input: UpdateObservationInput): Promise<void>;
  deleteObservation(id: string): Promise<void>;
  setPersonalReferenceRange(measurementCode: string, input: PersonalReferenceRangeInput): Promise<void>;
  removePersonalReferenceRange(measurementCode: string): Promise<void>;
  resetStandaloneData(): Promise<void>;
  listHealthEvents(query?: HealthEventListQuery): Promise<Awaited<ReturnType<CompanionCareService["listHealthEvents"]>>>;
  createHealthEvent(payload: CreateHealthEventInput): Promise<void>;
  updateHealthEvent(id: string, payload: CreateHealthEventInput): Promise<void>;
  deleteHealthEvent(id: string): Promise<void>;
  listCareItems(query?: CareItemListQuery): Promise<Awaited<ReturnType<CompanionCareService["listCareItems"]>>>;
  createCareItem(payload: CreateCareItemInput): Promise<void>;
  updateCareItem(id: string, payload: CreateCareItemInput): Promise<void>;
  completeCareItem(id: string, payload: CompleteCareItemInput): Promise<void>;
  deleteCareItem(id: string): Promise<void>;
  listMedications(query?: MedicationListQuery): Promise<Awaited<ReturnType<CompanionCareService["listMedications"]>>>;
  createMedication(payload: CreateMedicationInput): Promise<void>;
  updateMedication(id: string, payload: CreateMedicationInput): Promise<void>;
  deleteMedication(id: string): Promise<void>;
  refreshAfterImport(): Promise<void>;
  clearTransientData(): void;
  disconnect(): Promise<void>;
}

const MobileApiContext = createContext<MobileApiContextValue | undefined>(undefined);

export function MobileApiProvider({ children }: { children: React.ReactNode }) {
  const [connection, setConnection] = useState<ConnectionDetails | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [demoMode, setDemoModeState] = useState(false);
  const [operatingMode, setOperatingModeState] = useState<CompanionOperatingMode>("standalone");
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [bootstrap, setBootstrap] = useState<AppBootstrap>();
  const [analytics, setAnalytics] = useState<AnalyticsSummary>();
  const [summary, setSummary] = useState<HealthDataSummary>();
  const [profilePhoto, setProfilePhoto] = useState<ConnectedProfilePhoto>();
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [trackLoading, setTrackLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string>();
  const [transientRevision, setTransientRevision] = useState(0);
  const [migrationProgress, setMigrationProgress] = useState<{ uploaded: number; total: number }>();
  const generation = useRef(0);
  const profilePhotoRef = useRef<ConnectedProfilePhoto | undefined>(undefined);
  const syncOperation = useRef<{ promise: Promise<boolean>; force: boolean } | undefined>(undefined);
  const storeKeepAlive = useRef<(() => Promise<void>) | undefined>(undefined);
  const demoSource = useMemo(() => createDemoDataSource(), []);
  // The standalone and connected sources hold a lease on the shared encrypted SQLite database, so
  // they are built inside effects rather than `useMemo`: an effect's cleanup is guaranteed to run
  // for every instance it created. A `useMemo` body can run without its value ever being retained
  // (React StrictMode double-invocation, or a render React throws away), which used to orphan a
  // lease and leave `resetLocalData` permanently refusing to run.
  const [standaloneSource, setStandaloneSource] = useState<ReturnType<typeof createStandaloneDataSource>>();
  useEffect(() => {
    if (!shouldCreateStandaloneSource(preferencesLoaded, operatingMode, demoMode)) {
      setStandaloneSource(undefined);
      return;
    }
    const created = createStandaloneDataSource();
    setStandaloneSource(created);
    return () => {
      setStandaloneSource((current) => (current === created ? undefined : current));
      void (created as Partial<CompanionLifecycleService>).dispose?.();
    };
  }, [demoMode, operatingMode, preferencesLoaded]);

  const [connectedSource, setConnectedSource] = useState<ReturnType<typeof createConnectedDataSource>>();
  const connectedSourceConnection = useMemo(() => connection, [
    connection?.deviceId,
    connection?.pairingId,
    connection?.profileId,
    connection?.publicKeyHash,
    connection?.serverInstanceId,
    connection?.token,
    connection?.url
  ]);
  useEffect(() => {
    if (!preferencesLoaded || demoMode || operatingMode === "standalone" || !connectedSourceConnection?.token) {
      setConnectedSource(undefined);
      return;
    }
    const created = createConnectedDataSource(connectedSourceConnection);
    setConnectedSource(created);
    return () => {
      setConnectedSource((current) => (current === created ? undefined : current));
      void (created as Partial<CompanionLifecycleService>).dispose?.();
    };
  }, [connectedSourceConnection, demoMode, operatingMode, preferencesLoaded]);

  const source = useMemo<CompanionDataSource | undefined>(() => {
    if (!preferencesLoaded) return undefined;
    if (demoMode) return demoSource;
    if (operatingMode === "standalone") return standaloneSource;
    return connectedSource;
  }, [connectedSource, demoMode, demoSource, operatingMode, preferencesLoaded, standaloneSource]);

  // Releases the keep-alive taken during a mode switch, once the replacement source exists and has
  // taken its own lease on the shared encrypted database.
  useEffect(() => {
    const release = storeKeepAlive.current;
    if (!release) return;
    storeKeepAlive.current = undefined;
    void release();
  }, [source]);

  const clearHealthData = useCallback(() => {
    setBootstrap(undefined);
    setAnalytics(undefined);
    setSummary(undefined);
    profilePhotoRef.current = undefined;
    setProfilePhoto(undefined);
  }, []);

  const classifyError = useCallback((caught: unknown) => {
    setConnectionState(connectionStateForError(caught));
    setError(userFacingError(caught, "Unable to reach the paired PC."));
  }, []);

  const updateConnectionState = useCallback((currentSource: CompanionDataSource, ...results: object[]) => {
    const connectedSource = currentSource as Partial<ConnectedReplicaMaintenance>;
    const caught = results.map((result) => connectedSource.connectionError?.(result)).find(Boolean);
    if (caught) {
      classifyError(caught);
    } else {
      setConnectionState("online");
      setError(undefined);
    }
  }, [classifyError]);

  const synchronizeConnectedData = useCallback((force = false): Promise<boolean> => {
    const connectedSource = source as Partial<ConnectedReplicaMaintenance> | undefined;
    const synchronizeReplica = connectedSource?.synchronizeConnectedReplica;
    if (!synchronizeReplica) return Promise.resolve(false);
    const inFlight = syncOperation.current;
    // A background sync can decide the replica is still fresh and skip the network entirely.
    // Joining it would make an explicit pull-to-refresh silently no-op, so a forced request instead
    // chains after whatever is running.
    if (inFlight && (!force || inFlight.force)) return inFlight.promise;
    setSyncing(true);
    const run = () => synchronizeReplica({ force })
      .then((changed) => {
        setConnectionState("online");
        setError(undefined);
        return changed;
      })
      .catch((caught: unknown) => {
        classifyError(caught);
        return false;
      });
    const operation: { promise: Promise<boolean>; force: boolean } = {
      force,
      promise: (inFlight ? inFlight.promise.catch(() => false).then(run) : run())
        .finally(() => {
          if (syncOperation.current === operation) {
            syncOperation.current = undefined;
            setSyncing(false);
          }
        })
    };
    syncOperation.current = operation;
    return operation.promise;
  }, [classifyError, source]);

  const reloadConnection = useCallback(async (options: { preserveSession?: boolean } = {}) => {
    const next = await loadConnection();
    setConnection(next);
    if (options.preserveSession) return;
    generation.current += 1;
    clearHealthData();
    setError(undefined);
    setConnectionState(demoMode || operatingMode === "standalone" ? "online" : next?.token ? "connecting" : "unpaired");
  }, [clearHealthData, demoMode, operatingMode]);

  const setDemoMode = useCallback(async (enabled: boolean) => {
    await saveDemoMode(enabled);
    generation.current += 1;
    setDemoModeState(enabled);
    clearHealthData();
    setError(undefined);
    setConnectionState(enabled || operatingMode === "standalone" ? "online" : connection?.token ? "connecting" : "unpaired");
  }, [clearHealthData, connection, operatingMode]);

  const setOperatingMode = useCallback(async (mode: CompanionOperatingMode) => {
    if (mode === "connected" && !connection?.token) throw new Error("Pair with a PC before activating the connection.");
    // Keeps the encrypted database open while the old source is torn down and the new one is built.
    // Released by the effect above once the replacement source has taken its own lease.
    await storeKeepAlive.current?.();
    storeKeepAlive.current = await retainConnectedStore().catch(() => undefined);
    try {
      if (mode === "connected" && connection) {
        const pendingSource = createConnectedDataSource(connection);
        setConnectionState("connecting");
        setError(undefined);
        try {
          const preparedConnection = await pendingSource.prepareConnectedReplica();
          setConnection(preparedConnection);
        } catch (caught) {
          classifyError(caught);
          throw caught;
        } finally {
          await pendingSource.dispose?.();
        }
      }
      await saveOperatingMode(mode);
    } catch (caught) {
      const release = storeKeepAlive.current;
      storeKeepAlive.current = undefined;
      await release?.();
      throw caught;
    }
    generation.current += 1;
    setOperatingModeState(mode);
    clearHealthData();
    setError(undefined);
    setConnectionState(mode === "standalone" ? "online" : "connecting");
  }, [classifyError, clearHealthData, connection]);

  const standaloneMigrationManifest = useCallback(async () => {
    const migrationSource = standaloneSource as StandaloneMigrationSource | undefined;
    if (!migrationSource) throw new Error("Local phone data is unavailable for migration.");
    return migrationSource.migrationManifest();
  }, [standaloneSource]);

  const migrateStandaloneData = useCallback(async () => {
    if (!connection?.token) throw new Error("Pair with a PC before migrating local data.");
    const migrationSource = standaloneSource as StandaloneMigrationSource | undefined;
    if (!migrationSource) throw new Error("Local phone data is unavailable for migration.");
    const api = createCompanionApi(connection, LONG_RUNNING_PINNED_REQUEST_TIMEOUT_MS);
    const manifest = await migrationSource.migrationManifest();
    const started = await retryPinnedRequest(() => api.mobileMigration.start({ manifest }));
    const processed = new Set(started.processedBatchIds);
    // Derived from the manifest rather than a materialised batch list, so the batches themselves can
    // stream out of SQLite one page at a time instead of all sitting in memory at once.
    const total = Object.values(manifest.counts)
      .reduce((sum, count) => sum + Math.ceil(count / DEFAULT_MIGRATION_BATCH_SIZE), 0);
    let uploaded = 0;
    setMigrationProgress({ uploaded, total });
    try {
      for await (const batch of migrationSource.streamMigrationBatches(started.sessionId)) {
        if (processed.has(batch.batchId)) {
          uploaded += 1;
          setMigrationProgress({ uploaded, total });
          continue;
        }
        await retryPinnedRequest(() => api.mobileMigration.uploadBatch(batch));
        uploaded += 1;
        setMigrationProgress({ uploaded, total });
      }
      const receipt = await retryPinnedRequest(() => api.mobileMigration.complete({
        protocolVersion: 1,
        sessionId: started.sessionId
      }));
      await migrationSource.archiveAfterMigration(receipt, connection.url);
      return receipt;
    } finally {
      setMigrationProgress(undefined);
    }
  }, [connection, standaloneSource]);

  const discardStandaloneDataAndConnect = useCallback(async () => {
    if (!connection?.token) throw new Error("Pair with a PC before deleting local data.");
    const migrationSource = standaloneSource as StandaloneMigrationSource | undefined;
    if (!migrationSource) throw new Error("Local phone data is unavailable.");
    await migrationSource.deleteSelectedDataset();
    await setOperatingMode("connected");
  }, [connection, setOperatingMode, standaloneSource]);

  const refreshDashboard = useCallback(async (options: { synchronize?: boolean } = {}) => {
    if (!source) return;
    const requestGeneration = generation.current;
    setDashboardLoading(true);
    setError(undefined);
    try {
      if (options.synchronize) await synchronizeConnectedData(true);
      let [nextBootstrap, nextAnalytics] = await Promise.all([source.bootstrap(), source.analytics()]);
      let nextProfilePhoto = profilePhotoRef.current;
      if (operatingMode === "connected" && connection?.token) {
        nextProfilePhoto = await refreshConnectedProfilePhoto(
          () => createCompanionApi(connection).profilePhoto.get(),
          cacheProfilePhoto,
          profilePhotoRef.current
        );
        nextBootstrap = {
          ...nextBootstrap,
          profilePhoto: nextProfilePhoto
            ? { revision: nextProfilePhoto.revision, updatedAt: nextProfilePhoto.updatedAt }
            : undefined
        };
      }
      if (generation.current !== requestGeneration) return;
      setBootstrap(nextBootstrap);
      setAnalytics(nextAnalytics);
      profilePhotoRef.current = nextProfilePhoto;
      setProfilePhoto(nextProfilePhoto);
      updateConnectionState(source, nextBootstrap, nextAnalytics);
    } catch (caught) {
      if (generation.current === requestGeneration) classifyError(caught);
    } finally {
      if (generation.current === requestGeneration) setDashboardLoading(false);
    }
  }, [classifyError, connection, operatingMode, source, synchronizeConnectedData, updateConnectionState]);

  const refreshTrack = useCallback(async (options: { synchronize?: boolean } = {}) => {
    if (!source) return;
    const requestGeneration = generation.current;
    setTrackLoading(true);
    setError(undefined);
    try {
      if (options.synchronize) await synchronizeConnectedData(true);
      const nextSummary = await source.summary();
      if (generation.current !== requestGeneration) return;
      setSummary(nextSummary);
      updateConnectionState(source, nextSummary);
    } catch (caught) {
      if (generation.current === requestGeneration) classifyError(caught);
    } finally {
      if (generation.current === requestGeneration) setTrackLoading(false);
    }
  }, [classifyError, source, synchronizeConnectedData, updateConnectionState]);

  const healthDataDetail = useCallback(async (measurementCode: string, page?: DetailPage) => {
    if (!source) throw new Error("Health data is unavailable while the companion is disconnected.");
    const detail = await source.healthDataDetail(measurementCode, page);
    updateConnectionState(source, detail);
    return detail;
  }, [source, updateConnectionState]);

  const observationGroup = useCallback(async (id: string) => {
    if (!source) throw new Error("Observation groups are unavailable while the companion is disconnected.");
    const detail = await source.observationGroup(id);
    updateConnectionState(source, detail);
    return detail;
  }, [source, updateConnectionState]);

  const listObservationGroups = useCallback(async (query?: ObservationGroupListQuery) => {
    if (!source) throw new Error("Observation groups are unavailable while the companion is disconnected.");
    const page = await source.listObservationGroups(query);
    updateConnectionState(source, page);
    return page;
  }, [source, updateConnectionState]);

  const journal = useCallback(async (query: JournalQueryInput, signal?: AbortSignal) => {
    if (!source) throw new Error("Journal is unavailable while the companion is disconnected.");
    const page = await source.journal(query, signal);
    updateConnectionState(source, page);
    return page;
  }, [source, updateConnectionState]);

  const calendarMonth = useCallback(async (query: CalendarMonthQuery, signal?: AbortSignal) => {
    if (!source) throw new Error("Calendar is unavailable while the companion is disconnected.");
    const result = await source.calendarMonth(query, signal);
    updateConnectionState(source, result);
    return result;
  }, [source, updateConnectionState]);

  const bodyTrendTimeline = useCallback(async (query: BodyTrendQuery, signal?: AbortSignal) => {
    if (!source) throw new Error("Body Trend is unavailable while the companion is disconnected.");
    const result = await source.bodyTrendTimeline(query, signal);
    updateConnectionState(source, result);
    return result;
  }, [source, updateConnectionState]);

  const runMutation = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation();
    } catch (caught) {
      if (operatingMode === "connected") classifyError(caught);
      throw caught;
    }
  }, [classifyError, operatingMode]);

  const healthDataChartSeries = useCallback(async (
    measurementCode: string,
    options: HealthDataChartSeriesOptions
  ) => {
    if (!source) throw new Error("Health data is unavailable while the companion is disconnected.");
    return source.healthDataChartSeries(measurementCode, options);
  }, [source]);

  const importManualObservations = useCallback(async (payload: ManualObservationPayload) => {
    return runMutation(async () => {
      if (!source) throw new Error("Manual import is unavailable until a data source is ready.");
      const mutations = source as Partial<CompanionMutationService>;
      if (mutations.importManualObservations) return mutations.importManualObservations(payload);
      if (!connection?.token) throw new Error("Pair with a PC before importing readings.");
      return createCompanionApi(connection).importManualObservations(payload);
    });
  }, [connection, runMutation, source]);

  const updateObservation = useCallback(async (id: string, input: UpdateObservationInput) => {
    await runMutation(() => requireObservationMutationService(source).updateObservation(id, input));
  }, [runMutation, source]);

  const deleteObservation = useCallback(async (id: string) => {
    await runMutation(() => requireObservationMutationService(source).deleteObservation(id));
  }, [runMutation, source]);

  const setPersonalReferenceRange = useCallback(async (measurementCode: string, input: PersonalReferenceRangeInput) => {
    await runMutation(() => requireReferenceRangeMutationService(source).setPersonalReferenceRange(measurementCode, input));
  }, [runMutation, source]);

  const removePersonalReferenceRange = useCallback(async (measurementCode: string) => {
    await runMutation(() => requireReferenceRangeMutationService(source).removePersonalReferenceRange(measurementCode));
  }, [runMutation, source]);

  const resetStandaloneData = useCallback(async () => {
    if (operatingMode !== "standalone" || !standaloneSource) throw new Error("Local phone data is unavailable for reset.");
    await (standaloneSource as CompanionMaintenanceService).resetLocalData();
    generation.current += 1;
    clearHealthData();
    setError(undefined);
    setConnectionState("online");
    await Promise.all([refreshDashboard(), refreshTrack()]);
  }, [clearHealthData, operatingMode, refreshDashboard, refreshTrack, standaloneSource]);

  const listHealthEvents = useCallback(async (query?: HealthEventListQuery) => {
    const result = await requireCareService(source).listHealthEvents(query);
    updateConnectionState(source!, result);
    return result;
  }, [source, updateConnectionState]);

  const createHealthEvent = useCallback(async (payload: CreateHealthEventInput) => {
    await runMutation(() => requireCareService(source).createHealthEvent(payload));
  }, [runMutation, source]);

  const updateHealthEvent = useCallback(async (id: string, payload: CreateHealthEventInput) => {
    await runMutation(() => requireCareService(source).updateHealthEvent(id, payload));
  }, [runMutation, source]);

  const deleteHealthEvent = useCallback(async (id: string) => {
    await runMutation(() => requireCareService(source).deleteHealthEvent(id));
  }, [runMutation, source]);

  const listCareItems = useCallback(async (query?: CareItemListQuery) => {
    const result = await requireCareService(source).listCareItems(query);
    updateConnectionState(source!, result);
    return result;
  }, [source, updateConnectionState]);

  const createCareItem = useCallback(async (payload: CreateCareItemInput) => {
    await runMutation(() => requireCareService(source).createCareItem(payload));
  }, [runMutation, source]);

  const updateCareItem = useCallback(async (id: string, payload: CreateCareItemInput) => {
    await runMutation(() => requireCareService(source).updateCareItem(id, payload));
  }, [runMutation, source]);

  const completeCareItem = useCallback(async (id: string, payload: CompleteCareItemInput) => {
    await runMutation(() => requireCareService(source).completeCareItem(id, payload));
  }, [runMutation, source]);

  const deleteCareItem = useCallback(async (id: string) => {
    await runMutation(() => requireCareService(source).deleteCareItem(id));
  }, [runMutation, source]);

  const listMedications = useCallback(async (query?: MedicationListQuery) => {
    const result = await requireCareService(source).listMedications(query);
    updateConnectionState(source!, result);
    return result;
  }, [source, updateConnectionState]);

  const createMedication = useCallback(async (payload: CreateMedicationInput) => {
    await runMutation(() => requireCareService(source).createMedication(payload));
  }, [runMutation, source]);

  const updateMedication = useCallback(async (id: string, payload: CreateMedicationInput) => {
    await runMutation(() => requireCareService(source).updateMedication(id, payload));
  }, [runMutation, source]);

  const deleteMedication = useCallback(async (id: string) => {
    await runMutation(() => requireCareService(source).deleteMedication(id));
  }, [runMutation, source]);

  const refreshAfterImport = useCallback(async () => {
    await synchronizeConnectedData(true);
    await Promise.all([refreshDashboard(), refreshTrack()]);
  }, [refreshDashboard, refreshTrack, synchronizeConnectedData]);

  const clearTransientData = useCallback(() => {
    setTransientRevision((current) => current + 1);
    profilePhotoRef.current = undefined;
    setProfilePhoto(undefined);
  }, []);

  const cancelPendingConnection = useCallback(async () => {
    if (!connection?.token || operatingMode !== "standalone") return;
    await queueConnectionRevocation(connection);
    try {
      await retryPendingRevocation();
    } catch {
      // Securely retain the credential for revocation when the paired PC is reachable again.
    }
    generation.current += 1;
    await Promise.all([clearConnection(), clearSelectedProfileId()]);
    setConnection(null);
    setConnectionState("online");
    clearHealthData();
    clearTransientData();
  }, [clearHealthData, clearTransientData, connection, operatingMode]);

  const disconnect = useCallback(async () => {
    if (demoMode || !connection?.token) return;
    await queueConnectionRevocation(connection);
    try {
      await retryPendingRevocation();
    } catch {
      // Securely retain the credential for revocation when the paired PC is reachable again.
    }
    generation.current += 1;
    await (source as Partial<ConnectedReplicaMaintenance> | undefined)?.deleteConnectedReplica?.();
    const freshLocalSource = createStandaloneDataSource();
    try {
      await (freshLocalSource as StandaloneMigrationSource).createFreshDataset();
    } finally {
      await freshLocalSource.dispose?.();
    }
    await saveOperatingMode("standalone");
    await Promise.all([clearConnection(), clearSelectedProfileId()]);
    setConnection(null);
    setOperatingModeState("standalone");
    setConnectionState("online");
    clearHealthData();
    clearTransientData();
  }, [clearHealthData, clearTransientData, connection, demoMode, source]);

  useEffect(() => {
    let current = true;
    void Promise.all([loadConnection(), loadDemoMode(), loadOperatingMode()])
      .then(([nextConnection, nextDemoMode, storedMode]) => {
        if (!current) return;
        const nextOperatingMode = resolveOperatingMode(storedMode, Boolean(nextConnection?.token));
        generation.current += 1;
        setConnection(nextConnection);
        setDemoModeState(nextDemoMode);
        setOperatingModeState(nextOperatingMode);
        setConnectionState(nextDemoMode || nextOperatingMode === "standalone" ? "online" : nextConnection?.token ? "connecting" : "unpaired");
        setPreferencesLoaded(true);
        if (!storedMode) void saveOperatingMode(nextOperatingMode).catch(() => undefined);
      })
      .catch((caught: unknown) => {
        if (!current) return;
        generation.current += 1;
        setConnection(null);
        setDemoModeState(false);
        setOperatingModeState("standalone");
        setConnectionState("online");
        setError(userFacingError(caught, "Could not load saved app settings. Restart the app and try again."));
        setPreferencesLoaded(true);
      });
    return () => { current = false; };
  }, []);
  useEffect(() => {
    let current = true;
    if (source) {
      void Promise.all([refreshDashboard(), refreshTrack()]).then(async () => {
        const changed = await synchronizeConnectedData(false);
        if (current && changed) await Promise.all([refreshDashboard(), refreshTrack()]);
      });
    }
    return () => { current = false; };
  }, [source, refreshDashboard, refreshTrack, synchronizeConnectedData]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void retryPendingRevocation().catch(() => undefined);
        void synchronizeConnectedData(false).then((changed) => {
          void refreshDashboard();
          if (changed) void refreshTrack();
        });
      } else {
        clearTransientData();
      }
    });
    return () => subscription.remove();
  }, [clearTransientData, refreshDashboard, refreshTrack, synchronizeConnectedData]);
  useEffect(() => {
    void retryPendingRevocation().catch(() => undefined);
  }, []);

  const value = useMemo<MobileApiContextValue>(() => ({
    connection,
    connectionState,
    demoMode,
    operatingMode,
    standaloneMode: operatingMode === "standalone",
    bootstrap,
    analytics,
    summary,
    profilePhotoUri: bootstrap?.profilePhoto?.revision === profilePhoto?.revision ? profilePhoto?.uri : undefined,
    dashboardLoading,
    trackLoading,
    syncing,
    error,
    transientRevision,
    migrationProgress,
    reloadConnection,
    setDemoMode,
    setOperatingMode,
    standaloneMigrationManifest,
    migrateStandaloneData,
    discardStandaloneDataAndConnect,
    cancelPendingConnection,
    refreshDashboard,
    refreshTrack,
    synchronizeConnectedData,
    bodyTrendTimeline,
    calendarMonth,
    journal,
    healthDataDetail,
    observationGroup,
    listObservationGroups,
    healthDataChartSeries,
    importManualObservations,
    updateObservation,
    deleteObservation,
    setPersonalReferenceRange,
    removePersonalReferenceRange,
    resetStandaloneData,
    listHealthEvents,
    createHealthEvent,
    updateHealthEvent,
    deleteHealthEvent,
    listCareItems,
    createCareItem,
    updateCareItem,
    completeCareItem,
    deleteCareItem,
    listMedications,
    createMedication,
    updateMedication,
    deleteMedication,
    refreshAfterImport,
    clearTransientData,
    disconnect
  }), [
    analytics, bodyTrendTimeline, bootstrap, calendarMonth, cancelPendingConnection, clearTransientData, completeCareItem, connection, connectionState, createCareItem, createHealthEvent, createMedication,
    dashboardLoading, deleteCareItem, deleteHealthEvent, deleteMedication, deleteObservation, demoMode, discardStandaloneDataAndConnect, disconnect, error, healthDataChartSeries, healthDataDetail, journal, observationGroup,
    importManualObservations, listCareItems, listHealthEvents, listMedications, listObservationGroups, operatingMode, refreshAfterImport, refreshDashboard,
    profilePhoto, refreshTrack, reloadConnection, removePersonalReferenceRange, resetStandaloneData, setDemoMode, setOperatingMode, setPersonalReferenceRange, summary, syncing, synchronizeConnectedData, trackLoading,
    migrateStandaloneData, migrationProgress, standaloneMigrationManifest, transientRevision, updateCareItem, updateHealthEvent, updateMedication, updateObservation
  ]);
  return <MobileApiContext.Provider value={value}>{children}</MobileApiContext.Provider>;
}

export function useMobileApi(): MobileApiContextValue {
  const value = useContext(MobileApiContext);
  if (!value) throw new Error("useMobileApi must be used inside MobileApiProvider.");
  return value;
}

function requireCareService(source: CompanionDataSource | undefined): CompanionCareService {
  const candidate = source as Partial<CompanionCareService> | undefined;
  if (
    !candidate?.listHealthEvents || !candidate.createHealthEvent || !candidate.updateHealthEvent ||
    !candidate.deleteHealthEvent || !candidate.listCareItems || !candidate.createCareItem ||
    !candidate.updateCareItem || !candidate.completeCareItem || !candidate.deleteCareItem ||
    !candidate.listMedications || !candidate.createMedication || !candidate.updateMedication || !candidate.deleteMedication
  ) {
    throw new Error("Pair with your PC to use Care.");
  }
  return candidate as CompanionCareService;
}

function requireObservationMutationService(
  source: CompanionDataSource | undefined
): CompanionObservationMutationService {
  const candidate = source as Partial<CompanionObservationMutationService> | undefined;
  if (!candidate?.updateObservation || !candidate.deleteObservation) {
    throw new Error("Observation editing is unavailable until a writable data source is ready.");
  }
  return candidate as CompanionObservationMutationService;
}

function requireReferenceRangeMutationService(
  source: CompanionDataSource | undefined
): CompanionReferenceRangeMutationService {
  const candidate = source as Partial<CompanionReferenceRangeMutationService> | undefined;
  if (!candidate?.setPersonalReferenceRange || !candidate.removePersonalReferenceRange) {
    throw new Error("Personal reference ranges require a paired PC.");
  }
  return candidate as CompanionReferenceRangeMutationService;
}
