import type {
  DataSource,
  MobileImportResult,
  MobileMigrationBatch,
  MobileMigrationManifest,
  MobileMigrationReceipt,
  Observation,
  ObservationGroup,
  ParsedImport,
  Profile,
  ReplicaIdentity,
  ReplicaPage,
  SourceImport,
  UpdateObservationInput
} from "@vitana/shared";
import {
  emptyCounts,
  entityOutcome,
  type LocalObservationAggregate,
  type LocalObservationPage,
  type LocalStore,
  type LocalStoreCounts
} from "./localStore";

export interface MemoryLocalStoreState {
  profiles: Map<string, Profile>;
  sourceImports: Map<string, SourceImport>;
  dataSources: Map<string, DataSource>;
  observationGroups: Map<string, ObservationGroup>;
  observations: Map<string, Observation>;
  migrationFingerprints: Map<string, string>;
}

export function createMemoryLocalStoreState(): MemoryLocalStoreState {
  return {
    profiles: new Map(),
    sourceImports: new Map(),
    dataSources: new Map(),
    observationGroups: new Map(),
    observations: new Map(),
    migrationFingerprints: new Map()
  };
}

export class MemoryLocalStore implements LocalStore {
  private profileId?: string;
  private archivedReceipts = new Map<string, MobileMigrationReceipt>();
  private replicas = new Map<string, {
    metadata: import("./localStore").LocalReplicaMetadata;
    entities: Map<string, { entityType: string; payload: Record<string, unknown>; revision: number }>;
  }>();

  constructor(private readonly state = createMemoryLocalStoreState()) {}

  async initialize(defaultProfile: Profile): Promise<void> {
    this.profileId = defaultProfile.id;
    if (!this.state.profiles.has(defaultProfile.id)) {
      this.state.profiles.set(defaultProfile.id, structuredClone(defaultProfile));
    }
    if (!this.state.migrationFingerprints.has(defaultProfile.id)) {
      this.state.migrationFingerprints.set(defaultProfile.id, `standalone:${defaultProfile.id}`);
    }
  }

  async createDataset(profile: Profile): Promise<void> {
    if (this.state.profiles.has(profile.id)) throw new Error("The local dataset already exists.");
    this.state.profiles.set(profile.id, structuredClone(profile));
    this.state.migrationFingerprints.set(profile.id, `standalone:${profile.id}`);
    this.profileId = profile.id;
  }

  async deleteSelectedDataset(): Promise<void> {
    await this.reset();
  }

  async listDatasets() {
    return [...this.state.profiles.values()].map((profile) => ({
      datasetId: profile.id,
      profileId: profile.id,
      displayName: profile.displayName,
      kind: "standalone" as const,
      lifecycleState: this.archivedReceipts.has(profile.id) ? "archived" as const : "active" as const,
      selected: this.profileId === profile.id
    }));
  }

  async selectDataset(datasetId: string): Promise<void> {
    if (!this.state.profiles.has(datasetId)) throw new Error("The selected local dataset is unavailable.");
    this.profileId = datasetId;
  }

  async getProfile(): Promise<Profile> {
    const profile = this.profileId ? this.state.profiles.get(this.profileId) : undefined;
    if (!profile) throw new Error("The local profile has not been initialized.");
    return structuredClone(profile);
  }

  async datasetMetadata() {
    const profileId = this.requireProfileId();
    const archivedReceipt = this.archivedReceipts.get(profileId);
    return {
      datasetId: profileId,
      profileId,
      kind: "standalone" as const,
      lifecycleState: archivedReceipt ? "archived" as const : "active" as const,
      migrationFingerprint: this.state.migrationFingerprints.get(profileId) ?? `standalone:${profileId}`,
      migrationReceipt: archivedReceipt
    };
  }

  async counts(): Promise<LocalStoreCounts> {
    return {
      ...emptyCounts(),
      imports: this.profileValues(this.state.sourceImports).length,
      observations: this.profileValues(this.state.observations).length
    };
  }

  async mergeImport(imported: ParsedImport): Promise<MobileImportResult> {
    this.assertWritable();
    const profileId = this.requireProfileId();
    const sourceImports = new Map(this.state.sourceImports);
    const dataSources = new Map(this.state.dataSources);
    const observationGroups = new Map(this.state.observationGroups);
    const observations = new Map(this.state.observations);
    const before = {
      sourceImports: this.profileValues(sourceImports).length,
      dataSources: this.profileValues(dataSources).length,
      observationGroups: this.profileValues(observationGroups).length,
      observations: this.profileValues(observations).length
    };
    const sourceImportKey = key(profileId, imported.sourceImport.id);
    const dataSourceKey = key(profileId, imported.dataSource.id);
    sourceImports.set(sourceImportKey, sourceImports.get(sourceImportKey) ?? structuredClone(imported.sourceImport));
    dataSources.set(dataSourceKey, dataSources.get(dataSourceKey) ?? structuredClone(imported.dataSource));
    for (const group of imported.observationGroups) {
      const groupKey = key(profileId, group.id);
      observationGroups.set(groupKey, observationGroups.get(groupKey) ?? structuredClone(group));
    }

    for (const observation of imported.observations) {
      const observationKey = key(profileId, observation.id);
      observations.set(observationKey, observations.get(observationKey) ?? structuredClone(observation));
    }
    this.state.sourceImports = sourceImports;
    this.state.dataSources = dataSources;
    this.state.observationGroups = observationGroups;
    this.state.observations = observations;
    if (
      this.profileValues(sourceImports).length !== before.sourceImports ||
      this.profileValues(dataSources).length !== before.dataSources ||
      this.profileValues(observationGroups).length !== before.observationGroups ||
      this.profileValues(observations).length !== before.observations
    ) {
      this.rotateMigrationFingerprint();
    }
    return {
      importId: imported.sourceImport.id,
      outcome: {
        sourceImports: entityOutcome(1, this.profileValues(sourceImports).length - before.sourceImports),
        dataSources: entityOutcome(1, this.profileValues(dataSources).length - before.dataSources),
        observationGroups: entityOutcome(imported.observationGroups.length, this.profileValues(observationGroups).length - before.observationGroups),
        observations: entityOutcome(imported.observations.length, this.profileValues(observations).length - before.observations),
        timeSeriesSamples: entityOutcome(imported.timeSeriesSamples.length, 0),
        activitySessions: entityOutcome(imported.activitySessions.length, 0)
      }
    };
  }

  async migrationManifest(): Promise<MobileMigrationManifest> {
    const metadata = await this.datasetMetadata();
    return {
      protocolVersion: 1,
      datasetId: metadata.datasetId,
      datasetFingerprint: metadata.migrationFingerprint,
      sourceProfileId: metadata.profileId,
      counts: {
        sourceImports: this.profileValues(this.state.sourceImports).length,
        dataSources: this.profileValues(this.state.dataSources).length,
        observationGroups: this.profileValues(this.state.observationGroups).length,
        observations: this.profileValues(this.state.observations).length
      }
    };
  }

  async exportMigrationBatches(sessionId: string, batchSize = 250): Promise<MobileMigrationBatch[]> {
    const batches: MobileMigrationBatch[] = [];
    const append = <T>(
      kind: string,
      values: T[],
      assign: (batch: MobileMigrationBatch, chunk: T[]) => void
    ) => {
      for (let offset = 0; offset < values.length; offset += batchSize) {
        const batch: MobileMigrationBatch = {
          protocolVersion: 1,
          sessionId,
          batchId: `${kind}-${String(offset / batchSize).padStart(6, "0")}`,
          sourceImports: [],
          dataSources: [],
          observationGroups: [],
          observations: []
        };
        assign(batch, structuredClone(values.slice(offset, offset + batchSize)));
        batches.push(batch);
      }
    };
    append("source-imports", this.profileValues(this.state.sourceImports), (batch, values) => { batch.sourceImports = values; });
    append("data-sources", this.profileValues(this.state.dataSources), (batch, values) => { batch.dataSources = values; });
    append("observation-groups", this.profileValues(this.state.observationGroups), (batch, values) => { batch.observationGroups = values; });
    append("observations", this.profileValues(this.state.observations), (batch, values) => { batch.observations = values; });
    return batches;
  }

  async archiveAfterMigration(receipt: MobileMigrationReceipt): Promise<void> {
    if ((await this.datasetMetadata()).migrationFingerprint !== receipt.datasetFingerprint) {
      throw new Error("Standalone data changed during migration. The updated dataset was not archived.");
    }
    this.archivedReceipts.set(this.requireProfileId(), structuredClone(receipt));
  }

  async latestObservationsByCode(): Promise<Observation[]> {
    const latest = new Map<string, Observation>();
    for (const observation of this.profileValues(this.state.observations)) {
      const current = latest.get(observation.measurementCode);
      if (!current || compareObservationsNewestFirst(observation, current) < 0) {
        latest.set(observation.measurementCode, observation);
      }
    }
    return [...latest.values()]
      .sort(compareObservationsNewestFirst)
      .map((value) => structuredClone(value));
  }

  async observationAggregates(): Promise<LocalObservationAggregate[]> {
    const rows = new Map<string, LocalObservationAggregate>();
    for (const observation of this.profileValues(this.state.observations)) {
      const current = rows.get(observation.measurementCode);
      rows.set(observation.measurementCode, {
        measurementCode: observation.measurementCode,
        count: (current?.count ?? 0) + 1,
        lastMeasuredAt: current?.lastMeasuredAt && current.lastMeasuredAt > observation.observedAt
          ? current.lastMeasuredAt
          : observation.observedAt
      });
    }
    return [...rows.values()];
  }

  async observationsByCode(measurementCode: string, limit: number, offset: number): Promise<LocalObservationPage> {
    const profileId = this.requireProfileId();
    const matching = this.profileValues(this.state.observations)
      .filter((observation) => observation.measurementCode === measurementCode)
      .sort((left, right) => right.observedAt.localeCompare(left.observedAt));
    return {
      total: matching.length,
      records: matching.slice(offset, offset + limit).map((observation) => {
        const source = this.state.dataSources.get(key(profileId, observation.sourceId));
        const sourceImport = source?.importId ? this.state.sourceImports.get(key(profileId, source.importId)) : undefined;
        const group = observation.observationGroupId
          ? this.state.observationGroups.get(key(profileId, observation.observationGroupId))
          : undefined;
        return {
          ...structuredClone(observation),
          sourceKind: source?.sourceKind,
          sourceLabel: source?.label,
          importFileName: sourceImport?.fileName,
          importedAt: sourceImport?.importedAt,
          group: group ? {
            id: group.id,
            kind: group.kind,
            label: group.label,
            collectedAt: group.collectedAt
          } : undefined
        };
      })
    };
  }

  async updateObservation(id: string, input: UpdateObservationInput): Promise<Observation | undefined> {
    this.assertWritable();
    const observationKey = key(this.requireProfileId(), id);
    const existing = this.state.observations.get(observationKey);
    if (!existing) return undefined;
    const updated = {
      ...existing,
      measurementCode: input.measurementCode,
      observedAt: input.observedAt,
      value: input.value,
      unit: input.unit,
      note: input.note
    };
    this.state.observations.set(observationKey, updated);
    this.rotateMigrationFingerprint();
    return structuredClone(updated);
  }

  async deleteObservation(id: string): Promise<Observation | undefined> {
    this.assertWritable();
    const observationKey = key(this.requireProfileId(), id);
    const existing = this.state.observations.get(observationKey);
    if (!existing) return undefined;
    this.state.observations.delete(observationKey);
    this.rotateMigrationFingerprint();
    return structuredClone(existing);
  }

  async close(): Promise<void> {}

  async replicaMetadata(identity: ReplicaIdentity) {
    return this.replicas.get(replicaId(identity))?.metadata;
  }

  async applyReplicaPage(page: ReplicaPage): Promise<void> {
    const identity = { serverInstanceId: page.serverInstanceId, profileId: page.profileId, pairingId: page.pairingId };
    const id = replicaId(identity);
    const existing = this.replicas.get(id);
    const next: {
      metadata: import("./localStore").LocalReplicaMetadata;
      entities: Map<string, { entityType: string; payload: Record<string, unknown>; revision: number }>;
    } = existing ? {
      metadata: structuredClone(existing.metadata),
      entities: new Map([...existing.entities].map(([key, value]) => [key, structuredClone(value)]))
    } : {
      metadata: {
        ...identity,
        cursorSequence: 0,
        revision: 0,
        initialSnapshotCompleted: false
      },
      entities: new Map()
    };
    if (page.kind === "delta" && !next.metadata.initialSnapshotCompleted) {
      throw new Error("Complete the first connected snapshot before applying deltas.");
    }
    for (const change of page.changes) {
      const key = `${change.entityType}\u0000${change.entityId}`;
      const current = next.entities.get(key);
      if ((current?.revision ?? -1) > change.revision) continue;
      if (change.operation === "tombstone") next.entities.delete(key);
      else if (change.payload) next.entities.set(key, {
        entityType: change.entityType,
        payload: structuredClone(change.payload),
        revision: change.revision
      });
      else throw new Error("Replica upsert payload is missing.");
    }
    next.metadata.revision = Math.max(next.metadata.revision, page.highWaterMark.revision);
    next.metadata.cachedAt = page.cachedAt;
    next.metadata.appliedAt = new Date().toISOString();
    if (page.kind === "snapshot" && page.complete) {
      next.metadata.initialSnapshotCompleted = true;
      next.metadata.cursorSequence = page.highWaterMark.sequence;
    } else if (page.kind === "delta") {
      next.metadata.cursorSequence = page.complete
        ? page.highWaterMark.sequence
        : Math.max(next.metadata.cursorSequence, ...page.changes.map((change) => change.sequence));
    }
    next.metadata.snapshotCursor = next.metadata.initialSnapshotCompleted
      ? undefined
      : (page.kind === "snapshot" ? page.nextCursor : next.metadata.snapshotCursor);
    this.replicas.set(id, next);
  }

  async replicaEntities(identity: ReplicaIdentity) {
    const replica = this.replicas.get(replicaId(identity));
    if (!replica?.metadata.initialSnapshotCompleted) {
      throw new Error("Connected data is unavailable offline until the first snapshot completes.");
    }
    return [...replica.entities.values()].map(({ entityType, payload }) => ({
      entityType,
      payload: structuredClone(payload)
    }));
  }

  async deleteReplica(identity: ReplicaIdentity): Promise<void> {
    this.replicas.delete(replicaId(identity));
  }

  async reset(): Promise<void> {
    const profileId = this.requireProfileId();
    this.state.profiles.delete(profileId);
    this.state.migrationFingerprints.delete(profileId);
    this.archivedReceipts.delete(profileId);
    for (const values of [
      this.state.sourceImports,
      this.state.dataSources,
      this.state.observationGroups,
      this.state.observations
    ]) {
      for (const entryKey of values.keys()) {
        if (entryKey.startsWith(`${profileId}\u0000`)) values.delete(entryKey);
      }
    }
    this.profileId = undefined;
  }

  private rotateMigrationFingerprint(): void {
    const profileId = this.requireProfileId();
    this.state.migrationFingerprints.set(profileId, `standalone:${profileId}:${globalThis.crypto.randomUUID()}`);
  }

  private requireProfileId(): string {
    if (!this.profileId) throw new Error("The local profile has not been initialized.");
    return this.profileId;
  }

  private assertWritable(): void {
    if (this.archivedReceipts.has(this.requireProfileId())) {
      throw new Error("This migrated Standalone dataset is a read-only archive.");
    }
  }

  private profileValues<T>(values: Map<string, T>): T[] {
    const prefix = `${this.requireProfileId()}\u0000`;
    return [...values.entries()].filter(([entryKey]) => entryKey.startsWith(prefix)).map(([, value]) => value);
  }
}

function key(profileId: string, id: string): string {
  return `${profileId}\u0000${id}`;
}

function replicaId(identity: ReplicaIdentity): string {
  return `${identity.serverInstanceId}:${identity.profileId}:${identity.pairingId}`;
}

function compareObservationsNewestFirst(left: Observation, right: Observation): number {
  return right.observedAt.localeCompare(left.observedAt) || right.id.localeCompare(left.id);
}
