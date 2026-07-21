import type {
  DataSource,
  MobileImportResult,
  Observation,
  ObservationGroup,
  ParsedImport,
  Profile,
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
}

export function createMemoryLocalStoreState(): MemoryLocalStoreState {
  return {
    profiles: new Map(),
    sourceImports: new Map(),
    dataSources: new Map(),
    observationGroups: new Map(),
    observations: new Map()
  };
}

export class MemoryLocalStore implements LocalStore {
  private profileId?: string;

  constructor(private readonly state = createMemoryLocalStoreState()) {}

  async initialize(defaultProfile: Profile): Promise<void> {
    this.profileId = defaultProfile.id;
    if (!this.state.profiles.has(defaultProfile.id)) {
      this.state.profiles.set(defaultProfile.id, structuredClone(defaultProfile));
    }
  }

  async getProfile(): Promise<Profile> {
    const profile = this.profileId ? this.state.profiles.get(this.profileId) : undefined;
    if (!profile) throw new Error("The local profile has not been initialized.");
    return structuredClone(profile);
  }

  async counts(): Promise<LocalStoreCounts> {
    return {
      ...emptyCounts(),
      imports: this.profileValues(this.state.sourceImports).length,
      observations: this.profileValues(this.state.observations).length
    };
  }

  async mergeImport(imported: ParsedImport): Promise<MobileImportResult> {
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

  async recentObservations(limit: number): Promise<Observation[]> {
    return this.profileValues(this.state.observations)
      .sort((left, right) => right.observedAt.localeCompare(left.observedAt))
      .slice(0, limit)
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
    return structuredClone(updated);
  }

  async deleteObservation(id: string): Promise<Observation | undefined> {
    const observationKey = key(this.requireProfileId(), id);
    const existing = this.state.observations.get(observationKey);
    if (!existing) return undefined;
    this.state.observations.delete(observationKey);
    return structuredClone(existing);
  }

  async close(): Promise<void> {}

  async reset(): Promise<void> {
    const profileId = this.requireProfileId();
    this.state.profiles.delete(profileId);
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

  private requireProfileId(): string {
    if (!this.profileId) throw new Error("The local profile has not been initialized.");
    return this.profileId;
  }

  private profileValues<T>(values: Map<string, T>): T[] {
    const prefix = `${this.requireProfileId()}\u0000`;
    return [...values.entries()].filter(([entryKey]) => entryKey.startsWith(prefix)).map(([, value]) => value);
  }
}

function key(profileId: string, id: string): string {
  return `${profileId}\u0000${id}`;
}
