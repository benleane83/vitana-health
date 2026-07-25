import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import type {
  AnalyticsSummary,
  AppBootstrap,
  CareItemListQuery,
  CompleteCareItemInput,
  CreateCareItemInput,
  CreateHealthEventInput,
  HealthDataDetail,
  HealthDataSummary,
  HealthEventListQuery,
  ManualObservationPayload,
  MobileMigrationManifest,
  MobileMigrationReceipt,
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
import {
  createConnectedDataSource,
  type ConnectedReplicaMaintenance
} from "./connected/connectedDataSource";
import type { StandaloneMigrationSource } from "./standalone/standaloneDataSource";
import type { LocalDatasetSummary } from "./standalone/localStore";
import { userFacingError } from "./userFacingError";
import { queueConnectionRevocation, retryPendingRevocation } from "./pendingRevocation";

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
  error?: string;
  transientRevision: number;
  migrationProgress?: { uploaded: number; total: number };
  reloadConnection(): Promise<void>;
  setDemoMode(enabled: boolean): Promise<void>;
  setOperatingMode(mode: CompanionOperatingMode): Promise<void>;
  listStandaloneDatasets(): Promise<LocalDatasetSummary[]>;
  selectStandaloneDataset(datasetId: string): Promise<void>;
  standaloneMigrationManifest(): Promise<MobileMigrationManifest>;
  migrateStandaloneData(): Promise<MobileMigrationReceipt>;
  refreshDashboard(): Promise<void>;
  refreshTrack(): Promise<void>;
  healthDataDetail(measurementCode: string, page?: DetailPage): Promise<HealthDataDetail>;
  importManualObservations(payload: ManualObservationPayload): Promise<unknown>;
  updateObservation(id: string, input: UpdateObservationInput): Promise<void>;
  deleteObservation(id: string): Promise<void>;
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
  const [profilePhoto, setProfilePhoto] = useState<{ revision: string; uri: string }>();
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [trackLoading, setTrackLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [transientRevision, setTransientRevision] = useState(0);
  const [migrationProgress, setMigrationProgress] = useState<{ uploaded: number; total: number }>();
  const generation = useRef(0);
  const demoSource = useMemo(() => createDemoDataSource(), []);
  const standaloneSource = useMemo(
    () => shouldCreateStandaloneSource(preferencesLoaded, operatingMode, demoMode)
      ? createStandaloneDataSource()
      : undefined,
    [demoMode, operatingMode, preferencesLoaded]
  );
  const source = useMemo<CompanionDataSource | undefined>(() => {
    if (!preferencesLoaded) return undefined;
    if (demoMode) return demoSource;
    if (operatingMode === "standalone") return standaloneSource;
    return connection?.token ? createConnectedDataSource(connection) : undefined;
  }, [connection, demoMode, demoSource, operatingMode, preferencesLoaded, standaloneSource]);

  const clearHealthData = useCallback(() => {
    setBootstrap(undefined);
    setAnalytics(undefined);
    setSummary(undefined);
    setProfilePhoto(undefined);
  }, []);

  const classifyError = useCallback((caught: unknown) => {
    setConnectionState(connectionStateForError(caught));
    setError(userFacingError(caught, "Unable to reach the paired PC."));
  }, []);

  const reloadConnection = useCallback(async () => {
    const next = await loadConnection();
    generation.current += 1;
    setConnection(next);
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
    if (mode === "connected" && !connection?.token) throw new Error("Pair with a PC before using Connected mode.");
    await saveOperatingMode(mode);
    generation.current += 1;
    setOperatingModeState(mode);
    clearHealthData();
    setError(undefined);
    setConnectionState(mode === "standalone" ? "online" : "connecting");
  }, [clearHealthData, connection]);

  const standaloneMigrationManifest = useCallback(async () => {
    const migrationSource = standaloneSource as StandaloneMigrationSource | undefined;
    if (!migrationSource) throw new Error("Switch to Standalone mode before migrating local data.");
    return migrationSource.migrationManifest();
  }, [standaloneSource]);

  const listStandaloneDatasets = useCallback(async () => {
    const migrationSource = standaloneSource as StandaloneMigrationSource | undefined;
    return migrationSource ? migrationSource.listDatasets() : [];
  }, [standaloneSource]);

  const migrateStandaloneData = useCallback(async () => {
    if (!connection?.token) throw new Error("Pair with a PC before migrating local data.");
    const migrationSource = standaloneSource as StandaloneMigrationSource | undefined;
    if (!migrationSource) throw new Error("Switch to Standalone mode before migrating local data.");
    const api = createCompanionApi(connection);
    const manifest = await migrationSource.migrationManifest();
    const started = await api.mobileMigration.start({ manifest });
    const batches = await migrationSource.exportMigrationBatches(started.sessionId);
    const processed = new Set(started.processedBatchIds);
    const pending = batches.filter((batch) => !processed.has(batch.batchId));
    setMigrationProgress({ uploaded: batches.length - pending.length, total: batches.length });
    try {
      for (const batch of pending) {
        await api.mobileMigration.uploadBatch(batch);
        setMigrationProgress((current) => ({
          uploaded: (current?.uploaded ?? 0) + 1,
          total: batches.length
        }));
      }
      const receipt = await api.mobileMigration.complete({
        protocolVersion: 1,
        sessionId: started.sessionId
      });
      await migrationSource.archiveAfterMigration(receipt, connection.url);
      return receipt;
    } finally {
      setMigrationProgress(undefined);
    }
  }, [connection, standaloneSource]);

  const refreshDashboard = useCallback(async () => {
    if (!source) return;
    const requestGeneration = generation.current;
    setDashboardLoading(true);
    setError(undefined);
    try {
      const [nextBootstrap, nextAnalytics] = await Promise.all([source.bootstrap(), source.analytics()]);
      if (generation.current !== requestGeneration) return;
      setBootstrap(nextBootstrap);
      setAnalytics(nextAnalytics);
      setProfilePhoto(undefined);
      setConnectionState("online");
    } catch (caught) {
      if (generation.current === requestGeneration) classifyError(caught);
    } finally {
      if (generation.current === requestGeneration) setDashboardLoading(false);
    }
  }, [classifyError, source]);

  const refreshTrack = useCallback(async () => {
    if (!source) return;
    const requestGeneration = generation.current;
    setTrackLoading(true);
    setError(undefined);
    try {
      const nextSummary = await source.summary();
      if (generation.current !== requestGeneration) return;
      setSummary(nextSummary);
      setConnectionState("online");
    } catch (caught) {
      if (generation.current === requestGeneration) classifyError(caught);
    } finally {
      if (generation.current === requestGeneration) setTrackLoading(false);
    }
  }, [classifyError, source]);

  const selectStandaloneDataset = useCallback(async (datasetId: string) => {
    const migrationSource = standaloneSource as StandaloneMigrationSource | undefined;
    if (!migrationSource) throw new Error("Switch to Standalone mode before selecting local data.");
    await migrationSource.selectDataset(datasetId);
    generation.current += 1;
    clearHealthData();
    setError(undefined);
    await Promise.all([refreshDashboard(), refreshTrack()]);
  }, [clearHealthData, refreshDashboard, refreshTrack, standaloneSource]);

  const healthDataDetail = useCallback(async (measurementCode: string, page?: DetailPage) => {
    if (!source) throw new Error("Health data is unavailable while the companion is disconnected.");
    return source.healthDataDetail(measurementCode, page);
  }, [source]);

  const importManualObservations = useCallback(async (payload: ManualObservationPayload) => {
    if (!source) throw new Error("Manual import is unavailable until a data source is ready.");
    const mutations = source as Partial<CompanionMutationService>;
    if (mutations.importManualObservations) return mutations.importManualObservations(payload);
    if (operatingMode === "connected") {
      throw new Error("Connected cached data is read-only. Add records on the paired PC.");
    }
    if (!connection?.token) throw new Error("Pair with a PC before importing readings.");
    return createCompanionApi(connection).importManualObservations(payload);
  }, [connection, operatingMode, source]);

  const updateObservation = useCallback(async (id: string, input: UpdateObservationInput) => {
    await requireObservationMutationService(source).updateObservation(id, input);
  }, [source]);

  const deleteObservation = useCallback(async (id: string) => {
    await requireObservationMutationService(source).deleteObservation(id);
  }, [source]);

  const resetStandaloneData = useCallback(async () => {
    if (operatingMode !== "standalone" || !standaloneSource) throw new Error("Switch to Standalone mode before resetting local storage.");
    await (standaloneSource as CompanionMaintenanceService).resetLocalData();
    generation.current += 1;
    clearHealthData();
    setError(undefined);
    setConnectionState("online");
    await Promise.all([refreshDashboard(), refreshTrack()]);
  }, [clearHealthData, operatingMode, refreshDashboard, refreshTrack, standaloneSource]);

  const listHealthEvents = useCallback(async (query?: HealthEventListQuery) => {
    return requireCareService(source).listHealthEvents(query);
  }, [source]);

  const createHealthEvent = useCallback(async (payload: CreateHealthEventInput) => {
    await requireCareService(source).createHealthEvent(payload);
  }, [source]);

  const updateHealthEvent = useCallback(async (id: string, payload: CreateHealthEventInput) => {
    await requireCareService(source).updateHealthEvent(id, payload);
  }, [source]);

  const deleteHealthEvent = useCallback(async (id: string) => {
    await requireCareService(source).deleteHealthEvent(id);
  }, [source]);

  const listCareItems = useCallback(async (query?: CareItemListQuery) => {
    return requireCareService(source).listCareItems(query);
  }, [source]);

  const createCareItem = useCallback(async (payload: CreateCareItemInput) => {
    await requireCareService(source).createCareItem(payload);
  }, [source]);

  const updateCareItem = useCallback(async (id: string, payload: CreateCareItemInput) => {
    await requireCareService(source).updateCareItem(id, payload);
  }, [source]);

  const completeCareItem = useCallback(async (id: string, payload: CompleteCareItemInput) => {
    await requireCareService(source).completeCareItem(id, payload);
  }, [source]);

  const deleteCareItem = useCallback(async (id: string) => {
    await requireCareService(source).deleteCareItem(id);
  }, [source]);

  const refreshAfterImport = useCallback(async () => {
    await Promise.all([refreshDashboard(), refreshTrack()]);
  }, [refreshDashboard, refreshTrack]);

  const clearTransientData = useCallback(() => {
    setTransientRevision((current) => current + 1);
    setProfilePhoto(undefined);
  }, []);

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
    await Promise.all([clearConnection(), clearSelectedProfileId()]);
    setConnection(null);
    setConnectionState("unpaired");
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
    if (source) void Promise.all([refreshDashboard(), refreshTrack()]);
  }, [source, refreshDashboard, refreshTrack]);
  useEffect(() => () => {
    void (source as Partial<CompanionLifecycleService> | undefined)?.dispose?.();
  }, [source]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void retryPendingRevocation().catch(() => undefined);
        void Promise.all([refreshDashboard(), refreshTrack()]);
      } else {
        clearTransientData();
      }
    });
    return () => subscription.remove();
  }, [clearTransientData, refreshDashboard, refreshTrack]);
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
    error,
    transientRevision,
    migrationProgress,
    reloadConnection,
    setDemoMode,
    setOperatingMode,
    listStandaloneDatasets,
    selectStandaloneDataset,
    standaloneMigrationManifest,
    migrateStandaloneData,
    refreshDashboard,
    refreshTrack,
    healthDataDetail,
    importManualObservations,
    updateObservation,
    deleteObservation,
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
    refreshAfterImport,
    clearTransientData,
    disconnect
  }), [
    analytics, bootstrap, clearTransientData, completeCareItem, connection, connectionState, createCareItem, createHealthEvent,
    dashboardLoading, deleteCareItem, deleteHealthEvent, deleteObservation, demoMode, disconnect, error, healthDataDetail,
  importManualObservations, listCareItems, listHealthEvents, listStandaloneDatasets, operatingMode, refreshAfterImport, refreshDashboard,
  profilePhoto, refreshTrack, reloadConnection, resetStandaloneData, setDemoMode, setOperatingMode, summary, trackLoading,
  migrateStandaloneData, migrationProgress, selectStandaloneDataset, standaloneMigrationManifest, transientRevision, updateCareItem, updateHealthEvent, updateObservation
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
    !candidate.updateCareItem || !candidate.completeCareItem || !candidate.deleteCareItem
  ) {
    throw new Error("Switch to Connected mode to use Care.");
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
