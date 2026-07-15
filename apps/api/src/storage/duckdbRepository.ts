import { createHash, randomBytes } from "node:crypto";
import { existsSync, renameSync, rmSync } from "node:fs";
import type duckdb from "duckdb";
import {
  classifyValue,
  computeAnalyticsFromInput,
  defaultMeasurementTypes,
  healthStoreDataSchema,
  insightSchema,
  profileSchema,
  type AnalyticsSummary,
  type AppBootstrap,
  type DeleteObservationResponse,
  type DeleteObservationsByTypeResponse,
  type HealthDataDetailEntry,
  type HealthDataSummaryTypeRow,
  type HealthStoreData,
  type MeasurementType,
  type Observation,
  type ObservationGroup,
  type Profile,
  type SourceImport,
  type UpdateObservationInput,
  type UpdateObservationResponse
} from "@local-fitness-advisor/shared";
import {
  type MeasurementDetailPage,
  summarizeMeasurementEntries,
  summarizeSummaryRows
} from "../summary.js";
import {
  closeEncryptedDuckDbDatabase,
  createDuckDbSchema,
  migrateDuckDbSchema,
  openEncryptedDuckDbDatabase,
  type DuckDbOptions,
  type EncryptedDuckDbDatabase
} from "./duckdbRuntime.js";
import type { ImportMutationResult, ProfileImport, ProfileRepository } from "./profileRepository.js";

export class DuckDbRepository implements ProfileRepository {
  private closed = false;

  private constructor(
    private readonly handle: EncryptedDuckDbDatabase,
    private readonly testHooks: NonNullable<DuckDbOptions["testHooks"]> = {}
  ) {}

  static async hydrate(
    root: string,
    databasePath: string,
    key: string,
    store: HealthStoreData,
    options: DuckDbOptions = {}
  ): Promise<DuckDbRepository> {
    if (existsSync(databasePath)) {
      throw new Error("DuckDB hydration requires a new database path.");
    }
    const validated = healthStoreDataSchema.parse(store) as HealthStoreData;
    const temporaryPath = `${databasePath}.hydrating-${process.pid}-${randomBytes(6).toString("hex")}`;
    await createDuckDbSchema(root, temporaryPath, key, options);
    const repository = await DuckDbRepository.open(root, temporaryPath, key, options);
    let transactionStarted = false;
    try {
      await exec(repository.connection, "BEGIN TRANSACTION;");
      transactionStarted = true;
      await repository.insertStore(validated);
      await exec(repository.connection, "COMMIT;");
      transactionStarted = false;
      await repository.checkpoint();
      const exported = await repository.snapshot();
      if (digestHealthStoreData(exported) !== digestHealthStoreData(validated)) {
        throw new Error(`DuckDB hydration validation failed before atomic promotion at ${firstDifferencePath(validated, exported)}.`);
      }
      await repository.close();
      await options.testHooks?.beforeHydrationPromotion?.();
      renameSync(temporaryPath, databasePath);
      return DuckDbRepository.open(root, databasePath, key, options);
    } catch (error) {
      if (transactionStarted) {
        await exec(repository.connection, "ROLLBACK;").catch(() => undefined);
      }
      await repository.close().catch(() => undefined);
      rmSync(temporaryPath, { force: true });
      throw error;
    }
  }

  static async open(
    root: string,
    databasePath: string,
    key: string,
    options: DuckDbOptions = {}
  ): Promise<DuckDbRepository> {
    if (!existsSync(databasePath)) {
      throw new Error("DuckDB repository refuses to create an empty database while opening.");
    }
    const handle = await openEncryptedDuckDbDatabase(root, databasePath, key, options);
    try {
      await migrateDuckDbSchema(handle);
      const repository = new DuckDbRepository(handle, options.testHooks);
      await repository.reconcileDefaultMeasurementTypes();
      return repository;
    } catch (error) {
      await closeEncryptedDuckDbDatabase(handle).catch(() => undefined);
      throw error;
    }
  }

  async schemaVersions(): Promise<number[]> {
    this.assertOpen();
    const rows = await all(this.connection, "SELECT schema_version FROM poc_metadata ORDER BY schema_version;");
    return rows.map((row) => Number(row.schema_version));
  }

  private async reconcileDefaultMeasurementTypes(): Promise<void> {
    const profileRows = await all(this.connection, "SELECT COUNT(*) AS count FROM profile;");
    if (Number(profileRows[0]?.count ?? 0) === 0) {
      return;
    }
    const [existingRows, referencedRows] = await Promise.all([
      all(this.connection, "SELECT * EXCLUDE (ordinal) FROM measurement_types;"),
      all(this.connection, `
        SELECT measurement_code FROM observations
        UNION
        SELECT measurement_code FROM time_series_samples;
      `)
    ]);
    const existingByCode = new Map(existingRows.map((row) => [String(row.code), row]));
    const referencedCodes = new Set(referencedRows.map((row) => String(row.measurement_code)));
    const referencedDefaultTypes = defaultMeasurementTypes.filter((type) => referencedCodes.has(type.code));
    const missingTypes = referencedDefaultTypes.filter((type) => !existingByCode.has(type.code));
    const retiredTypes = defaultMeasurementTypes.filter((type) => {
      const existing = existingByCode.get(type.code);
      return String(existing?.category) === "metabolic";
    });
    if (missingTypes.length === 0 && retiredTypes.length === 0) {
      return;
    }
    await this.transaction(async () => {
      const ordinalRows = await all(this.connection, "SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal FROM measurement_types;");
      let ordinal = Number(ordinalRows[0]?.ordinal ?? 0);
      for (const entry of missingTypes) {
        await run(
          this.connection,
          "INSERT INTO measurement_types VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);",
          ordinal,
          entry.code,
          entry.display,
          entry.category,
          entry.kind,
          entry.canonicalUnit,
          json(entry.aliases),
          entry.aggregation,
          json(measurementTypeProperties(entry))
        );
        ordinal += 1;
      }
      for (const entry of retiredTypes) {
        await run(
          this.connection,
          `UPDATE measurement_types
           SET display = ?, category = ?, kind = ?, canonical_unit = ?, aliases = ?, aggregation = ?, custom_properties = ?
           WHERE code = ?;`,
          entry.display,
          entry.category,
          entry.kind,
          entry.canonicalUnit,
          json(entry.aliases),
          entry.aggregation,
          json(measurementTypeProperties(entry)),
          entry.code
        );
      }
    });
  }

  async snapshot(options: { includeRaw?: boolean } = { includeRaw: true }): Promise<HealthStoreData> {
    this.assertOpen();
    const profileRows = await all(this.connection, "SELECT * FROM profile;");
    if (profileRows.length !== 1) {
      throw new Error(`DuckDB expected exactly one profile row, found ${profileRows.length}.`);
    }
    const profile = profileFromRow(profileRows[0]);

    const importRows = options.includeRaw === true
      ? await orderedRows(this.connection, "imports")
      : await all(this.connection, "SELECT * EXCLUDE (ordinal, raw_content) FROM imports ORDER BY ordinal;");
    const sourceImports = importRows.map((row) => compact({
      id: row.id,
      sourceKind: row.source_kind,
      fileName: row.file_name,
      importedAt: isoTimestamp(row.imported_at),
      parserVersion: row.parser_version,
      checksum: row.checksum,
      rowCount: Number(row.row_count),
      status: row.status,
      diagnostics: requiredJson(row.diagnostics),
      rawContent: row.raw_content
    }));
    const dataSources = (await orderedRows(this.connection, "sources")).map((row) => compact({
      id: row.id,
      sourceKind: row.source_kind,
      label: row.label,
      importId: row.import_id,
      createdAt: isoTimestamp(row.created_at)
    }));
    const devices = (await orderedRows(this.connection, "devices")).map((row) => compact({
      id: row.id,
      label: row.label,
      manufacturer: row.manufacturer,
      model: row.model,
      sourceId: row.source_id
    }));
    const measurementTypes = (await orderedRows(this.connection, "measurement_types")).map((row) => compact({
      code: row.code,
      display: row.display,
      category: row.category,
      kind: row.kind,
      canonicalUnit: row.canonical_unit,
      aliases: requiredJson(row.aliases),
      ...(optionalJson<Record<string, unknown>>(row.custom_properties) ?? {}),
      aggregation: row.aggregation
    }));
    const observationGroups = (await orderedRows(this.connection, "observation_groups")).map((row) => compact({
      id: row.id,
      kind: row.kind,
      label: row.label,
      sourceId: row.source_id,
      importId: row.import_id,
      startAt: optionalTimestamp(row.start_at),
      endAt: optionalTimestamp(row.end_at),
      collectedAt: optionalTimestamp(row.collected_at),
      metadata: optionalJson(row.metadata)
    }));
    const observations = (await orderedRows(this.connection, "observations")).map((row) => withStoredJson(compact({
      id: row.id,
      measurementCode: row.measurement_code,
      observedAt: isoTimestamp(row.observed_at),
      effectiveStart: optionalTimestamp(row.effective_start),
      effectiveEnd: optionalTimestamp(row.effective_end),
      value: Number(row.value),
      unit: row.unit,
      sourceId: row.source_id,
      observationGroupId: row.observation_group_id,
      deviceId: row.device_id,
      note: row.note
    }), row.source_json_present, row.source_json));
    const timeSeriesSamples = (await orderedRows(this.connection, "time_series_samples")).map((row) => withStoredJson(compact({
      id: row.id,
      measurementCode: row.measurement_code,
      startAt: isoTimestamp(row.start_at),
      endAt: isoTimestamp(row.end_at),
      value: Number(row.value),
      unit: row.unit,
      sourceId: row.source_id,
      deviceId: row.device_id
    }), row.source_json_present, row.source_json));
    const activitySessions = (await orderedRows(this.connection, "activities")).map((row) => withStoredJson(compact({
      id: row.id,
      activityType: row.activity_type,
      startAt: isoTimestamp(row.start_at),
      endAt: optionalTimestamp(row.end_at),
      durationMinutes: optionalNumber(row.duration_minutes),
      energyKcal: optionalNumber(row.energy_kcal),
      distanceMeters: optionalNumber(row.distance_meters),
      sourceId: row.source_id
    }), row.source_json_present, row.source_json));
    const insights = (await orderedRows(this.connection, "insights")).map((row) => compact({
      id: row.id,
      createdAt: isoTimestamp(row.created_at),
      title: row.title,
      body: row.body,
      evidence: requiredJson(row.evidence),
      confidence: row.confidence,
      model: row.model,
      safetyNotice: row.safety_notice
    }));
    const auditEvents = (await orderedRows(this.connection, "audit_events")).map((row) => compact({
      id: row.id,
      createdAt: isoTimestamp(row.created_at),
      eventType: row.event_type,
      detail: row.detail
    }));

    return healthStoreDataSchema.parse({
      schemaVersion: 2,
      profile,
      sourceImports,
      dataSources,
      devices,
      measurementTypes,
      observations,
      observationGroups,
      timeSeriesSamples,
      activitySessions,
      insights,
      auditEvents
    }) as HealthStoreData;
  }

  async appBootstrap(): Promise<AppBootstrap> {
    this.assertOpen();
    const [profileRows, measurementRows, templateRows, insightRows, counts] = await Promise.all([
      all(this.connection, "SELECT * FROM profile;"),
      all(this.connection, "SELECT * FROM measurement_types ORDER BY display, code;"),
      all(this.connection, `
        SELECT
          g.label,
          o.measurement_code,
          COALESCE(m.display, o.measurement_code) AS marker,
          COALESCE(NULLIF(m.canonical_unit, ''), o.unit) AS unit
        FROM observation_groups g
        JOIN observations o ON o.observation_group_id = g.id
        LEFT JOIN measurement_types m ON m.code = o.measurement_code
        WHERE g.kind = 'custom'
        GROUP BY g.label, o.measurement_code, m.display, m.canonical_unit, o.unit
        ORDER BY g.label, marker, o.measurement_code;
      `),
      all(this.connection, "SELECT * FROM insights ORDER BY created_at DESC, ordinal ASC LIMIT 1;"),
      this.storageCounts()
    ]);
    if (profileRows.length !== 1) {
      throw new Error("DuckDB expected exactly one profile row.");
    }

    const templatesByLabel = new Map<string, AppBootstrap["manualObservationGroupTemplates"][number]>();
    for (const row of templateRows) {
      const normalizedLabel = normalizeGroupLabel(String(row.label));
      const existing = templatesByLabel.get(normalizedLabel) ?? {
        label: String(row.label).trim(),
        normalizedLabel,
        measurements: []
      };
      existing.measurements.push({
        measurementCode: String(row.measurement_code),
        marker: String(row.marker),
        unit: String(row.unit)
      });
      templatesByLabel.set(normalizedLabel, existing);
    }
    return {
      profile: profileFromRow(profileRows[0]),
      measurementTypes: measurementRows.map(measurementTypeFromRow),
      manualObservationGroupTemplates: [...templatesByLabel.values()],
      latestInsight: insightRows[0] ? insightFromRow(insightRows[0]) : undefined,
      counts
    };
  }

  async analyticsSummary(): Promise<AnalyticsSummary> {
    this.assertOpen();
    const [measurementRows, observationRows, countRows] = await Promise.all([
      all(this.connection, "SELECT * EXCLUDE (ordinal) FROM measurement_types ORDER BY ordinal;"),
      all(this.connection, `
        SELECT * EXCLUDE (measurement_rank, category) FROM (
          SELECT
            o.* EXCLUDE (ordinal),
            o.ordinal,
            m.category,
            ROW_NUMBER() OVER (
              PARTITION BY o.measurement_code
              ORDER BY o.observed_at DESC, o.id DESC
            ) AS measurement_rank
          FROM observations o
          LEFT JOIN measurement_types m ON m.code = o.measurement_code
        )
        WHERE measurement_rank <= 12 OR category = 'lab'
        ORDER BY ordinal;
      `),
      all(this.connection, `
        SELECT
          (SELECT COUNT(*) FROM imports) AS imports,
          (SELECT COUNT(*) FROM observations) AS observations,
          (SELECT COUNT(*) FROM time_series_samples) AS samples,
          (SELECT COUNT(*) FROM activities) AS activities,
          (SELECT COUNT(*) FROM insights) AS insights;
      `)
    ]);
    const counts = countRows[0] ?? {};
    return computeAnalyticsFromInput({
      counts: {
        imports: Number(counts.imports ?? 0),
        observations: Number(counts.observations ?? 0),
        samples: Number(counts.samples ?? 0),
        activities: Number(counts.activities ?? 0),
        insights: Number(counts.insights ?? 0)
      },
      measurementTypes: measurementRows.map(measurementTypeFromRow),
      observations: observationRows.map(observationFromRow)
    });
  }

  async getProfile(): Promise<Profile> {
    this.assertOpen();
    const profileRows = await all(this.connection, "SELECT * FROM profile;");
    if (profileRows.length !== 1) {
      throw new Error(`DuckDB expected exactly one profile row, found ${profileRows.length}.`);
    }
    return profileFromRow(profileRows[0]);
  }

  async replaceProfile(profile: HealthStoreData["profile"]): Promise<HealthStoreData["profile"]> {
    this.assertOpen();
    return this.transaction(async () => {
      const current = await this.getProfile();
      const nextProfile = profileSchema.parse({
        ...profile,
        id: current.id,
        updatedAt: new Date().toISOString()
      });
      const profileProperties = nextProfile.cloudAiConsent
        ? json({ cloudAiConsent: nextProfile.cloudAiConsent })
        : null;
      await run(
        this.connection,
        `UPDATE profile SET display_name = ?, birth_year = ?, sex = ?, height_cm = ?, blood_type = ?,
          goal_summary = ?, units = ?, updated_at = ?, custom_properties = ? WHERE id = ?;`,
        nextProfile.displayName,
        nextProfile.birthYear ?? null,
        nextProfile.sex ?? null,
        nextProfile.heightCm ?? null,
        nextProfile.bloodType ?? null,
        nextProfile.goalSummary ?? null,
        nextProfile.units,
        nextProfile.updatedAt,
        profileProperties,
        current.id
      );
      await this.insertAudit("profile-updated", "Profile details updated locally.");
      return nextProfile;
    });
  }

  async mergeImport(parsed: DuckDbImport): Promise<ImportMutationResult> {
    this.assertOpen();
    return this.transaction(async () => {
      const sourceImport = sanitizeSourceImport(parsed.sourceImport);
      const duplicateImports = await allWithParams(
        this.connection,
        "SELECT 1 AS found FROM imports WHERE source_kind = ? AND checksum = ? AND file_name = ? LIMIT 1;",
        sourceImport.sourceKind,
        sourceImport.checksum,
        sourceImport.fileName
      );
      if (duplicateImports.length === 0) {
        await run(
          this.connection,
          "INSERT INTO imports VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
          await this.nextOrdinal("imports"),
          sourceImport.id,
          sourceImport.sourceKind,
          sourceImport.fileName,
          sourceImport.importedAt,
          sourceImport.parserVersion,
          sourceImport.checksum,
          sourceImport.rowCount,
          sourceImport.status,
          json(sourceImport.diagnostics),
          sourceImport.rawContent ?? null
        );
      }

      await insertRows(this.connection, "INSERT OR IGNORE INTO sources VALUES (?, ?, ?, ?, ?, ?);", [[
        await this.nextOrdinal("sources"),
        parsed.dataSource.id,
        parsed.dataSource.sourceKind,
        parsed.dataSource.label,
        parsed.dataSource.importId ?? null,
        parsed.dataSource.createdAt
      ]]);
      const groupFirstOrdinal = await this.nextOrdinal("observation_groups");
      await insertRows(this.connection, "INSERT OR IGNORE INTO observation_groups VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
        parsed.observationGroups.map((entry, index) => [
          groupFirstOrdinal + index,
          entry.id,
          entry.kind,
          entry.label,
          entry.sourceId ?? null,
          entry.importId ?? null,
          entry.startAt ?? null,
          entry.endAt ?? null,
          entry.collectedAt ?? null,
          optionalJsonValue(entry.metadata)
        ]));

      await insertObservationRows(this.connection, parsed.observations, await this.nextOrdinal("observations"));

      const sampleFirstOrdinal = await this.nextOrdinal("time_series_samples");
      await insertRows(this.connection, "INSERT OR IGNORE INTO time_series_samples VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
        parsed.timeSeriesSamples.map((entry, index) => [
          sampleFirstOrdinal + index,
          entry.id,
          entry.measurementCode,
          entry.startAt,
          entry.endAt,
          entry.value,
          entry.unit,
          entry.sourceId,
          entry.deviceId ?? null,
          entry.sourceJson !== undefined,
          optionalJsonValue(entry.sourceJson)
        ]));

      const activityFirstOrdinal = await this.nextOrdinal("activities");
      await insertRows(this.connection, "INSERT OR IGNORE INTO activities VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
        parsed.activitySessions.map((entry, index) => [
          activityFirstOrdinal + index,
          entry.id,
          entry.activityType,
          entry.startAt,
          entry.endAt ?? null,
          entry.durationMinutes ?? null,
          entry.energyKcal ?? null,
          entry.distanceMeters ?? null,
          entry.sourceId,
          entry.sourceJson !== undefined,
          optionalJsonValue(entry.sourceJson)
        ]));

      await this.pruneMeasurementRows("observations", "observed_at", maxObservations);
      await this.pruneMeasurementRows("time_series_samples", "end_at", maxTimeSeriesSamples);
      await this.pruneByNewest("observation_groups", "COALESCE(collected_at, end_at, start_at)", maxObservationGroups);
      await this.pruneByNewest("activities", "start_at", maxActivitySessions);
      const auditEvent = await this.insertAudit(
        "import-processed",
        `${sourceImport.sourceKind} import processed with ${sourceImport.rowCount} source row(s).`
      );
      return { counts: await this.storageCounts(), auditEvent };
    });
  }

  async addInsight(insight: HealthStoreData["insights"][number]): Promise<HealthStoreData["insights"][number]> {
    this.assertOpen();
    return this.transaction(async () => {
      const validatedInsight = insightSchema.parse(insight);
      const ordinal = await this.prependOrdinal("insights");
      await run(
        this.connection,
        "INSERT INTO insights VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);",
        ordinal, validatedInsight.id, validatedInsight.createdAt, validatedInsight.title, validatedInsight.body,
        json(validatedInsight.evidence), validatedInsight.confidence, validatedInsight.model, validatedInsight.safetyNotice
      );
      await this.insertAudit("insight-generated", `${validatedInsight.model} insight generated.`);
      return validatedInsight;
    });
  }

  async exportData(): Promise<HealthStoreData> {
    this.assertOpen();
    return this.transaction(async () => {
      await this.insertAudit("export-created", "Full local data export created.");
      return this.snapshot();
    });
  }

  async insertObservationRecord(observation: Observation): Promise<boolean> {
    this.assertOpen();
    return this.transaction(async () => {
      const existing = await allWithParams(this.connection, "SELECT 1 AS found FROM observations WHERE id = ? LIMIT 1;", observation.id);
      if (existing.length > 0) {
        return false;
      }
      const ordinal = await this.nextOrdinal("observations");
      await run(
        this.connection,
        "INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
        ordinal, observation.id, observation.measurementCode, observation.observedAt,
        observation.effectiveStart ?? null, observation.effectiveEnd ?? null, observation.value, observation.unit,
        observation.sourceId, observation.observationGroupId ?? null, observation.deviceId ?? null,
        observation.note ?? null, observation.sourceJson !== undefined, optionalJsonValue(observation.sourceJson)
      );
      return true;
    });
  }

  async importObservationRecords(parsed: Pick<DuckDbImport, "sourceImport" | "dataSource" | "observations">): Promise<number> {
    this.assertOpen();
    return this.transaction(async () => {
      const sourceImport = sanitizeSourceImport(parsed.sourceImport);
      const duplicateImports = await allWithParams(
        this.connection,
        "SELECT 1 AS found FROM imports WHERE source_kind = ? AND checksum = ? AND file_name = ? LIMIT 1;",
        sourceImport.sourceKind,
        sourceImport.checksum,
        sourceImport.fileName
      );
      if (duplicateImports.length === 0) {
        const importOrdinal = await this.nextOrdinal("imports");
        await run(
          this.connection,
          "INSERT INTO imports VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
          importOrdinal, sourceImport.id, sourceImport.sourceKind, sourceImport.fileName, sourceImport.importedAt,
          sourceImport.parserVersion, sourceImport.checksum, sourceImport.rowCount, sourceImport.status,
          json(sourceImport.diagnostics), sourceImport.rawContent ?? null
        );
      }
      const existingSources = await allWithParams(this.connection, "SELECT 1 AS found FROM sources WHERE id = ? LIMIT 1;", parsed.dataSource.id);
      if (existingSources.length === 0) {
        const sourceOrdinal = await this.nextOrdinal("sources");
        await run(
          this.connection,
          "INSERT INTO sources VALUES (?, ?, ?, ?, ?, ?);",
          sourceOrdinal, parsed.dataSource.id, parsed.dataSource.sourceKind, parsed.dataSource.label,
          parsed.dataSource.importId ?? null, parsed.dataSource.createdAt
        );
      }

      const currentRows = await all(this.connection, "SELECT id FROM observations;");
      const currentIds = new Set(currentRows.map((row) => String(row.id)));
      const incomingById = new Map(parsed.observations.map((entry) => [entry.id, entry]));
      const additions = [...incomingById.values()].filter((entry) => !currentIds.has(entry.id));
      if (currentIds.size + additions.length > maxObservations) {
        throw new Error(`DuckDB observation import exceeds the ${maxObservations} row limit.`);
      }
      const firstOrdinal = await this.nextOrdinal("observations");
      await insertObservationRows(this.connection, additions, firstOrdinal);
      return additions.length;
    });
  }

  async deleteObservationRecord(id: string): Promise<boolean> {
    this.assertOpen();
    return this.transaction(async () => {
      const existing = await allWithParams(this.connection, "SELECT 1 AS found FROM observations WHERE id = ? LIMIT 1;", id);
      if (existing.length === 0) {
        return false;
      }
      await run(this.connection, "DELETE FROM observations WHERE id = ?;", id);
      return true;
    });
  }

  async deleteObservationRecordsByMeasurementCode(measurementCode: string): Promise<number> {
    this.assertOpen();
    return this.transaction(async () => {
      const rows = await allWithParams(
        this.connection,
        "SELECT COUNT(*) AS count FROM observations WHERE measurement_code = ?;",
        measurementCode
      );
      const count = Number(rows[0]?.count ?? 0);
      if (count > 0) {
        await run(this.connection, "DELETE FROM observations WHERE measurement_code = ?;", measurementCode);
      }
      return count;
    });
  }

  async deleteObservation(id: string): Promise<DeleteObservationResponse | undefined> {
    this.assertOpen();
    return this.transaction(async () => {
      const rows = await allWithParams(this.connection, "SELECT * EXCLUDE (ordinal) FROM observations WHERE id = ?;", id);
      if (!rows[0]) {
        return undefined;
      }
      const observation = observationFromRow(rows[0]);
      await run(this.connection, "DELETE FROM observations WHERE id = ?;", id);
      await this.insertAudit("observation-deleted", observationDeleteDetail(observation));
      return {
        deletedCount: 1,
        deletedObservation: observation,
        counts: await this.storageCounts()
      };
    });
  }

  async updateObservation(id: string, input: UpdateObservationInput): Promise<UpdateObservationResponse | undefined> {
    this.assertOpen();
    return this.transaction(async () => {
      const rows = await allWithParams(this.connection, "SELECT 1 AS found FROM observations WHERE id = ? LIMIT 1;", id);
      if (!rows[0]) {
        return undefined;
      }
      await run(
        this.connection,
        `UPDATE observations SET measurement_code = ?, observed_at = ?, value = ?, unit = ?, note = ? WHERE id = ?;`,
        input.measurementCode,
        input.observedAt,
        input.value,
        input.unit,
        input.note ?? null,
        id
      );
      const updatedRows = await allWithParams(this.connection, "SELECT * EXCLUDE (ordinal) FROM observations WHERE id = ?;", id);
      const updatedObservation = observationFromRow(updatedRows[0]);
      await this.insertAudit("observation-updated", `${updatedObservation.measurementCode} observation updated for ${updatedObservation.observedAt}.`);
      return { updatedObservation, counts: await this.storageCounts() };
    });
  }

  async deleteObservationsByMeasurementCode(measurementCode: string): Promise<DeleteObservationsByTypeResponse> {
    this.assertOpen();
    return this.transaction(async () => {
      const countRows = await allWithParams(
        this.connection,
        "SELECT COUNT(*) AS count FROM observations WHERE measurement_code = ?;",
        measurementCode
      );
      const deletedCount = Number(countRows[0]?.count ?? 0);
      if (deletedCount > 0) {
        await run(this.connection, "DELETE FROM observations WHERE measurement_code = ?;", measurementCode);
        await this.insertAudit(
          "observation-type-deleted",
          `${deletedCount} observation(s) deleted for ${measurementCode}.`
        );
      }
      return {
        deletedCount,
        measurementCode,
        counts: await this.storageCounts()
      };
    });
  }

  async summary() {
    this.assertOpen();
    const rows = await all(this.connection, `
      WITH measurement_entries AS (
        SELECT measurement_code, 'observation' AS entry_kind, observed_at AS measured_at FROM observations
        UNION ALL
        SELECT measurement_code, 'sample' AS entry_kind, end_at AS measured_at FROM time_series_samples
        UNION ALL
        SELECT 'activity_sessions' AS measurement_code, 'activity' AS entry_kind, COALESCE(end_at, start_at) AS measured_at FROM activities
      )
      SELECT
        measurement_code,
        MIN(display) AS display_name,
        MIN(category) AS category,
        SUM(CASE WHEN entry_kind = 'observation' THEN 1 ELSE 0 END) AS observations,
        SUM(CASE WHEN entry_kind = 'sample' THEN 1 ELSE 0 END) AS samples,
        SUM(CASE WHEN entry_kind = 'activity' THEN 1 ELSE 0 END) AS activities,
        MAX(measured_at) AS last_measured_at
      FROM measurement_entries
      LEFT JOIN measurement_types ON measurement_types.code = measurement_entries.measurement_code
      GROUP BY measurement_code
      ORDER BY measurement_code;
    `);
    const summaryRows = rows.map((row) => {
      const observations = Number(row.observations);
      const samples = Number(row.samples);
      const activities = Number(row.activities);
      return {
        code: String(row.measurement_code),
        displayName: typeof row.display_name === "string" ? row.display_name : humanizeCode(String(row.measurement_code)),
        category: isSummaryCategory(row.category) ? row.category : "uncategorized",
        counts: {
          observations,
          samples,
          activities,
          total: observations + samples + activities
        },
        lastMeasuredAt: optionalTimestamp(row.last_measured_at)
      } satisfies HealthDataSummaryTypeRow;
    });
    return summarizeSummaryRows(summaryRows);
  }

  async measurementDetail(measurementCode: string, page: MeasurementDetailPage = { offset: 0, limit: 100 }) {
    this.assertOpen();
    const [typeRows, rows, countRows] = await Promise.all([
      allWithParams(this.connection, "SELECT * EXCLUDE (ordinal) FROM measurement_types WHERE code = ?;", measurementCode),
      allWithParams(this.connection, `
        SELECT * FROM (
          SELECT
            'observation' AS kind, o.id, o.measurement_code, o.observed_at AS measured_at, o.value, o.unit,
            s.label AS source_label, s.source_kind, i.file_name AS import_file_name, i.imported_at,
            o.note, g.id AS group_id, g.kind AS group_kind, g.label AS group_label, g.collected_at AS group_collected_at,
            NULL AS sample_start, NULL AS sample_end, NULL AS activity_type, NULL AS activity_start,
            NULL AS duration_minutes, NULL AS energy_kcal, NULL AS distance_meters
          FROM observations o
          LEFT JOIN sources s ON s.id = o.source_id
          LEFT JOIN imports i ON i.id = s.import_id
          LEFT JOIN observation_groups g ON g.id = o.observation_group_id
          WHERE o.measurement_code = ?
          UNION ALL
          SELECT
            'sample' AS kind, t.id, t.measurement_code, t.end_at AS measured_at, t.value, t.unit,
            s.label AS source_label, s.source_kind, i.file_name AS import_file_name, i.imported_at,
            NULL AS note, NULL AS group_id, NULL AS group_kind, NULL AS group_label, NULL AS group_collected_at,
            t.start_at AS sample_start, t.end_at AS sample_end, NULL AS activity_type, NULL AS activity_start,
            NULL AS duration_minutes, NULL AS energy_kcal, NULL AS distance_meters
          FROM time_series_samples t
          LEFT JOIN sources s ON s.id = t.source_id
          LEFT JOIN imports i ON i.id = s.import_id
          WHERE t.measurement_code = ?
          UNION ALL
          SELECT
            'activity' AS kind, a.id, 'activity_sessions' AS measurement_code, COALESCE(a.end_at, a.start_at) AS measured_at,
            COALESCE(a.duration_minutes, DATE_DIFF('minute', a.start_at, COALESCE(a.end_at, a.start_at))) AS value, 'min' AS unit,
            s.label AS source_label, s.source_kind, i.file_name AS import_file_name, i.imported_at,
            NULL AS note, NULL AS group_id, NULL AS group_kind, NULL AS group_label, NULL AS group_collected_at,
            NULL AS sample_start, NULL AS sample_end, a.activity_type, a.start_at AS activity_start,
            a.duration_minutes, a.energy_kcal, a.distance_meters
          FROM activities a
          LEFT JOIN sources s ON s.id = a.source_id
          LEFT JOIN imports i ON i.id = s.import_id
          WHERE ? = 'activity_sessions'
        )
        ORDER BY measured_at DESC, id
        LIMIT ? OFFSET ?;
      `, measurementCode, measurementCode, measurementCode, page.limit, page.offset),
      allWithParams(this.connection, `
        SELECT
          (SELECT COUNT(*) FROM observations WHERE measurement_code = ?) AS observations,
          (SELECT COUNT(*) FROM time_series_samples WHERE measurement_code = ?) AS samples,
          (SELECT COUNT(*) FROM activities WHERE ? = 'activity_sessions') AS activities,
          (SELECT MAX(observed_at) FROM observations WHERE measurement_code = ?) AS observation_latest,
          (SELECT MAX(end_at) FROM time_series_samples WHERE measurement_code = ?) AS sample_latest,
          (SELECT MAX(COALESCE(end_at, start_at)) FROM activities WHERE ? = 'activity_sessions') AS activity_latest;
      `, measurementCode, measurementCode, measurementCode, measurementCode, measurementCode, measurementCode)
    ]);
    const type = typeRows[0] ? measurementTypeFromRow(typeRows[0]) : undefined;
    const displayName = type?.display ?? humanizeCode(measurementCode);
    const entries = rows.map((row) => measurementDetailEntryFromRow(row, type, displayName));
    const countRow = countRows[0] ?? {};
    const counts = {
      observations: Number(countRow.observations ?? 0),
      samples: Number(countRow.samples ?? 0),
      activities: Number(countRow.activities ?? 0)
    };
    const total = counts.observations + counts.samples + counts.activities;
    const latestTimestamp = [
      optionalTimestamp(countRow.observation_latest),
      optionalTimestamp(countRow.sample_latest),
      optionalTimestamp(countRow.activity_latest)
    ].reduce<string | undefined>((latest, candidate) => !latest || (candidate && candidate > latest) ? candidate : latest, undefined);
    return summarizeMeasurementEntries(measurementCode, type, entries, {
      counts: { ...counts, total },
      latestTimestamp,
      pagination: {
        limit: page.limit,
        loaded: page.offset + entries.length,
        total,
        hasMore: page.offset + entries.length < total
      }
    });
  }

  async dailyMetrics(measurementCode?: string): Promise<DuckDbDailyMetric[]> {
    this.assertOpen();
    const rows = measurementCode === undefined
      ? await all(this.connection, `SELECT day, measurement_code, avg_value, min_value, max_value, n, unit
          FROM v_daily_metrics ORDER BY day, measurement_code;`)
      : await allWithParams(this.connection, `SELECT day, measurement_code, avg_value, min_value, max_value, n, unit
          FROM v_daily_metrics WHERE measurement_code = ? ORDER BY day;`, measurementCode);
    return rows.map((row) => ({
      day: dateOnly(row.day),
      measurementCode: String(row.measurement_code),
      avgValue: Number(row.avg_value),
      minValue: Number(row.min_value),
      maxValue: Number(row.max_value),
      count: Number(row.n),
      unit: String(row.unit)
    }));
  }

  async weeklyMetrics(measurementCode?: string): Promise<DuckDbWeeklyMetric[]> {
    this.assertOpen();
    const rows = measurementCode === undefined
      ? await all(this.connection, `SELECT week_start, measurement_code, avg_value, min_value, max_value, n, unit
          FROM v_weekly_metrics ORDER BY week_start, measurement_code;`)
      : await allWithParams(this.connection, `SELECT week_start, measurement_code, avg_value, min_value, max_value, n, unit
          FROM v_weekly_metrics WHERE measurement_code = ? ORDER BY week_start;`, measurementCode);
    return rows.map((row) => ({
      weekStart: dateOnly(row.week_start),
      measurementCode: String(row.measurement_code),
      avgValue: Number(row.avg_value),
      minValue: Number(row.min_value),
      maxValue: Number(row.max_value),
      count: Number(row.n),
      unit: String(row.unit)
    }));
  }

  async latestMeasurement(measurementCode: string): Promise<DuckDbMeasurementValue | undefined> {
    return (await this.measurementDetails(measurementCode, 1))[0];
  }

  async measurementDetails(measurementCode: string, limit?: number): Promise<DuckDbMeasurementValue[]> {
    this.assertOpen();
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      throw new Error("DuckDB measurement detail limit must be a positive integer.");
    }
    const rows = await allWithParams(
      this.connection,
      `SELECT kind, id, measured_at, value, unit FROM (
        SELECT 'observation' AS kind, id, observed_at AS measured_at, value, unit
        FROM observations WHERE measurement_code = ?
        UNION ALL
        SELECT 'sample' AS kind, id, end_at AS measured_at, value, unit
        FROM time_series_samples WHERE measurement_code = ?
      ) ORDER BY measured_at DESC, kind, id${limit === undefined ? "" : " LIMIT ?"};`,
      ...(limit === undefined ? [measurementCode, measurementCode] : [measurementCode, measurementCode, limit])
    );
    return rows.map((row) => ({
      kind: String(row.kind) as "observation" | "sample",
      id: String(row.id),
      timestamp: isoTimestamp(row.measured_at),
      value: Number(row.value),
      unit: String(row.unit)
    }));
  }

  async listActivities(options: DuckDbActivityQuery): Promise<DuckDbActivity[]> {
    this.assertOpen();
    const query = normalizeActivityQuery(options);
    const rows = await allWithParams(
      this.connection,
      `SELECT activity_type, start_at, end_at, duration_minutes, energy_kcal, distance_meters
        FROM activities
        WHERE start_at >= ? AND start_at <= ?
        ORDER BY start_at ${query.sort}
        LIMIT ?;`,
      `${query.startDate} 00:00:00`,
      `${query.endDate} 23:59:59`,
      query.limit
    );
    return rows.map((row) => compact({
      activityType: String(row.activity_type),
      startAt: isoTimestamp(row.start_at),
      endAt: optionalTimestamp(row.end_at),
      durationMinutes: optionalNumber(row.duration_minutes),
      energyKcal: optionalNumber(row.energy_kcal),
      distanceMeters: optionalNumber(row.distance_meters)
    }) as unknown as DuckDbActivity);
  }

  async countActivities(options: DuckDbActivityQuery): Promise<DuckDbActivityCount[]> {
    this.assertOpen();
    const query = normalizeActivityQuery(options);
    const rows = await allWithParams(
      this.connection,
      `SELECT activity_type, COUNT(*) AS count
        FROM activities
        WHERE start_at >= ? AND start_at <= ?
        GROUP BY activity_type
        ORDER BY count ${query.sort}
        LIMIT ?;`,
      `${query.startDate} 00:00:00`,
      `${query.endDate} 23:59:59`,
      query.limit
    );
    return rows.map((row) => ({
      activityType: String(row.activity_type),
      count: Number(row.count)
    }));
  }

  async runCompiledQuery(sql: string): Promise<Array<Record<string, unknown>>> {
    this.assertOpen();
    return all(this.connection, sql);
  }

  async checkpoint(): Promise<void> {
    this.assertOpen();
    await exec(this.connection, "CHECKPOINT;");
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await closeEncryptedDuckDbDatabase(this.handle);
  }

  private get connection(): duckdb.Connection {
    return this.handle.connection;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("DuckDB repository is closed.");
    }
  }

  private async transaction<T>(operation: () => Promise<T>): Promise<T> {
    await exec(this.connection, "BEGIN TRANSACTION;");
    try {
      const result = await operation();
      await this.testHooks.beforeTransactionCommit?.();
      await exec(this.connection, "COMMIT;");
      return result;
    } catch (error) {
      await exec(this.connection, "ROLLBACK;").catch(() => undefined);
      throw error;
    }
  }

  private async insertAudit(
    eventType: HealthStoreData["auditEvents"][number]["eventType"],
    detail: string
  ): Promise<HealthStoreData["auditEvents"][number]> {
    const rows = await all(this.connection, "SELECT COALESCE(MIN(ordinal), 1) - 1 AS ordinal FROM audit_events;");
    const auditEvent = {
      id: `audit_${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`,
      createdAt: new Date().toISOString(),
      eventType,
      detail
    };
    await run(
      this.connection,
      "INSERT INTO audit_events VALUES (?, ?, ?, ?, ?);",
      Number(rows[0]?.ordinal ?? 0),
      auditEvent.id,
      auditEvent.createdAt,
      auditEvent.eventType,
      auditEvent.detail
    );
    return auditEvent;
  }

  private async prependOrdinal(table: OrderedTable): Promise<number> {
    const rows = await all(this.connection, `SELECT COALESCE(MIN(ordinal), 1) - 1 AS ordinal FROM ${table};`);
    return Number(rows[0]?.ordinal ?? 0);
  }

  private async storageCounts(): Promise<AppBootstrap["counts"]> {
    const rows = await all(this.connection, `
      SELECT
        (SELECT COUNT(*) FROM imports) AS imports,
        (SELECT COUNT(*) FROM observations) AS observations,
        (SELECT COUNT(*) FROM time_series_samples) AS samples,
        (SELECT COUNT(*) FROM activities) AS activities;
    `);
    const counts = rows[0] ?? {};
    return {
      imports: Number(counts.imports ?? 0),
      observations: Number(counts.observations ?? 0),
      samples: Number(counts.samples ?? 0),
      activities: Number(counts.activities ?? 0)
    };
  }

  private async pruneMeasurementRows(
    table: "observations" | "time_series_samples",
    timestampColumn: "observed_at" | "end_at",
    maxItems: number
  ): Promise<void> {
    const countRows = await all(this.connection, `SELECT COUNT(*) AS count FROM ${table};`);
    if (Number(countRows[0]?.count ?? 0) <= maxItems) return;

    const rankedSql = `
      SELECT id, measurement_code, ${timestampColumn},
        ROW_NUMBER() OVER (PARTITION BY measurement_code ORDER BY ${timestampColumn} DESC, id DESC) AS measurement_rank
      FROM ${table}`;
    const protectedRows = await all(this.connection, `
      WITH ranked AS (${rankedSql})
      SELECT COUNT(*) AS count FROM ranked WHERE measurement_rank <= ${minPerMeasurementCode};
    `);
    const protectedCount = Number(protectedRows[0]?.count ?? 0);
    const remainingLimit = Math.max(0, maxItems - protectedCount);
    const retainedSql = remainingLimit === 0
      ? `
        WITH ranked AS (${rankedSql})
        SELECT id FROM (
          SELECT id FROM ranked WHERE measurement_rank <= ${minPerMeasurementCode}
          ORDER BY ${timestampColumn} DESC, id DESC
          LIMIT ${maxItems}
        )`
      : `
        WITH ranked AS (${rankedSql}), retained AS (
          SELECT id FROM ranked WHERE measurement_rank <= ${minPerMeasurementCode}
          UNION ALL
          SELECT id FROM (
            SELECT id FROM ranked WHERE measurement_rank > ${minPerMeasurementCode}
            ORDER BY ${timestampColumn} DESC, id DESC
            LIMIT ${remainingLimit}
          )
        )
        SELECT id FROM retained`;
    await exec(this.connection, `DELETE FROM ${table} WHERE id NOT IN (${retainedSql});`);
  }

  private async pruneByNewest(
    table: "observation_groups" | "activities",
    timestampExpression: string,
    maxItems: number
  ): Promise<void> {
    const countRows = await all(this.connection, `SELECT COUNT(*) AS count FROM ${table};`);
    if (Number(countRows[0]?.count ?? 0) <= maxItems) return;
    await exec(this.connection, `
      DELETE FROM ${table}
      WHERE id NOT IN (
        SELECT id FROM ${table}
        ORDER BY ${timestampExpression} DESC NULLS LAST, id DESC
        LIMIT ${maxItems}
      );
    `);
  }

  private async syncCollection<T extends { id: string }>(
    table: OrderedTable,
    current: T[],
    next: T[],
    insert: (ordinal: number, entry: T) => Promise<void>
  ): Promise<void> {
    const nextIds = new Set(next.map((entry) => entry.id));
    const currentIds = new Set(current.map((entry) => entry.id));
    for (const entry of current) {
      if (!nextIds.has(entry.id)) {
        await run(this.connection, `DELETE FROM ${table} WHERE id = ?;`, entry.id);
      }
    }
    let ordinal = await this.nextOrdinal(table);
    const addedIds: string[] = [];
    for (const entry of next) {
      if (!currentIds.has(entry.id)) {
        await insert(ordinal, entry);
        ordinal += 1;
        addedIds.push(entry.id);
      }
    }
    const retainedIds = current.filter((entry) => nextIds.has(entry.id)).map((entry) => entry.id);
    const currentOrderAfterChanges = [...retainedIds, ...addedIds];
    const nextOrder = next.map((entry) => entry.id);
    if (!arraysEqual(currentOrderAfterChanges, nextOrder)) {
      await exec(this.connection, `UPDATE ${table} SET ordinal = ordinal + 1000000000;`);
      for (let index = 0; index < nextOrder.length; index += 1) {
        await run(this.connection, `UPDATE ${table} SET ordinal = ? WHERE id = ?;`, index, nextOrder[index]);
      }
    }
  }

  private async nextOrdinal(table: OrderedTable): Promise<number> {
    const rows = await all(this.connection, `SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal FROM ${table};`);
    return Number(rows[0]?.ordinal ?? 0);
  }

  private async insertStore(store: HealthStoreData): Promise<void> {
    const profileProperties = store.profile.cloudAiConsent
      ? json({ cloudAiConsent: store.profile.cloudAiConsent })
      : null;
    await run(this.connection, "INSERT INTO profile VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
      store.profile.id, store.profile.displayName, store.profile.birthYear ?? null, store.profile.sex ?? null,
      store.profile.heightCm ?? null, store.profile.bloodType ?? null, store.profile.goalSummary ?? null,
      store.profile.units, store.profile.updatedAt, profileProperties);

    await insertRows(this.connection, "INSERT INTO imports VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
      store.sourceImports.map((entry, ordinal) => [ordinal, entry.id, entry.sourceKind, entry.fileName, entry.importedAt,
        entry.parserVersion, entry.checksum, entry.rowCount, entry.status, json(entry.diagnostics), entry.rawContent ?? null]));
    await insertRows(this.connection, "INSERT INTO sources VALUES (?, ?, ?, ?, ?, ?);",
      store.dataSources.map((entry, ordinal) => [ordinal, entry.id, entry.sourceKind, entry.label, entry.importId ?? null, entry.createdAt]));
    await insertRows(this.connection, "INSERT INTO devices VALUES (?, ?, ?, ?, ?, ?);",
      store.devices.map((entry, ordinal) => [ordinal, entry.id, entry.label, entry.manufacturer ?? null, entry.model ?? null, entry.sourceId ?? null]));
    await insertRows(this.connection, "INSERT INTO measurement_types VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);",
      store.measurementTypes.map((entry, ordinal) => [ordinal, entry.code, entry.display, entry.category, entry.kind,
        entry.canonicalUnit, json(entry.aliases), entry.aggregation, json(measurementTypeProperties(entry))]));
    await insertRows(this.connection, "INSERT INTO observation_groups VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
      store.observationGroups.map((entry, ordinal) => [ordinal, entry.id, entry.kind, entry.label, entry.sourceId ?? null,
        entry.importId ?? null, entry.startAt ?? null, entry.endAt ?? null, entry.collectedAt ?? null, optionalJsonValue(entry.metadata)]));
    await insertObservationRows(this.connection, store.observations, 0);
    await insertRows(this.connection, "INSERT INTO time_series_samples VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
      store.timeSeriesSamples.map((entry, ordinal) => [ordinal, entry.id, entry.measurementCode, entry.startAt, entry.endAt,
        entry.value, entry.unit, entry.sourceId, entry.deviceId ?? null, entry.sourceJson !== undefined, optionalJsonValue(entry.sourceJson)]));
    await insertRows(this.connection, "INSERT INTO activities VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
      store.activitySessions.map((entry, ordinal) => [ordinal, entry.id, entry.activityType, entry.startAt, entry.endAt ?? null,
        entry.durationMinutes ?? null, entry.energyKcal ?? null, entry.distanceMeters ?? null, entry.sourceId,
        entry.sourceJson !== undefined, optionalJsonValue(entry.sourceJson)]));
    await insertRows(this.connection, "INSERT INTO insights VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);",
      store.insights.map((entry, ordinal) => [ordinal, entry.id, entry.createdAt, entry.title, entry.body,
        json(entry.evidence), entry.confidence, entry.model, entry.safetyNotice]));
    await insertRows(this.connection, "INSERT INTO audit_events VALUES (?, ?, ?, ?, ?);",
      store.auditEvents.map((entry, ordinal) => [ordinal, entry.id, entry.createdAt, entry.eventType, entry.detail]));
  }
}

export function digestHealthStoreData(store: HealthStoreData): string {
  return createHash("sha256").update(canonicalJson(store)).digest("hex");
}

function measurementTypeFromRow(row: Record<string, unknown>): MeasurementType {
  return {
    code: String(row.code),
    display: String(row.display),
    category: String(row.category) as MeasurementType["category"],
    kind: String(row.kind) as MeasurementType["kind"],
    canonicalUnit: String(row.canonical_unit),
    aliases: requiredJson<string[]>(row.aliases),
    ...(optionalJson<Record<string, unknown>>(row.custom_properties) ?? {}),
    aggregation: String(row.aggregation) as MeasurementType["aggregation"]
  };
}

function observationFromRow(row: Record<string, unknown>): Observation {
  return withStoredJson(compact({
    id: row.id,
    measurementCode: row.measurement_code,
    observedAt: isoTimestamp(row.observed_at),
    effectiveStart: optionalTimestamp(row.effective_start),
    effectiveEnd: optionalTimestamp(row.effective_end),
    value: Number(row.value),
    unit: row.unit,
    sourceId: row.source_id,
    observationGroupId: row.observation_group_id,
    deviceId: row.device_id,
    note: row.note
  }), row.source_json_present, row.source_json) as unknown as Observation;
}

function measurementDetailEntryFromRow(
  row: Record<string, unknown>,
  type: MeasurementType | undefined,
  displayName: string
): HealthDataDetailEntry {
  const kind = String(row.kind) as HealthDataDetailEntry["kind"];
  const base = {
    kind,
    id: String(row.id),
    measurementCode: String(row.measurement_code),
    displayName,
    timestamp: isoTimestamp(row.measured_at),
    value: Number(row.value),
    unit: String(row.unit),
    sourceLabel: optionalString(row.source_label),
    sourceKind: optionalString(row.source_kind) as HealthDataDetailEntry["sourceKind"],
    importFileName: optionalString(row.import_file_name),
    importedAt: optionalTimestamp(row.imported_at)
  };
  if (kind === "observation") {
    const referenceRange = type?.referenceRanges?.find((range) => range.unit === base.unit);
    const groupId = optionalString(row.group_id);
    return {
      ...base,
      note: optionalString(row.note),
      observationGroup: groupId
        ? {
            id: groupId,
            kind: String(row.group_kind) as ObservationGroup["kind"],
            label: String(row.group_label),
            collectedAt: optionalTimestamp(row.group_collected_at)
          }
        : undefined,
      referenceRange,
      status: type ? classifyValue(base.value, type, base.unit) : "unknown",
      canDelete: true,
      deleteLabel: "Delete"
    };
  }
  if (kind === "sample") {
    const startAt = isoTimestamp(row.sample_start);
    const endAt = isoTimestamp(row.sample_end);
    return {
      ...base,
      note: startAt !== endAt ? `${startAt} → ${endAt}` : undefined
    };
  }
  const detailNotes = [
    `Type: ${String(row.activity_type)}`,
    row.energy_kcal === null || row.energy_kcal === undefined ? undefined : `Energy: ${Number(row.energy_kcal).toFixed(1)} kcal`,
    row.distance_meters === null || row.distance_meters === undefined ? undefined : `Distance: ${Number(row.distance_meters).toFixed(1)} m`
  ].filter((note): note is string => Boolean(note));
  return { ...base, note: detailNotes.join(" • ") };
}

function isSummaryCategory(value: unknown): value is HealthDataSummaryTypeRow["category"] {
  return value === "activity" || value === "cardio" || value === "sleep" || value === "body" ||
    value === "lab" || value === "derived" || value === "uncategorized";
}

function humanizeCode(code: string): string {
  return code.replaceAll("_", " ").replace(/\b\w/g, (segment) => segment.toUpperCase());
}

function normalizeGroupLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function measurementTypeProperties(entry: MeasurementType): Record<string, unknown> {
  return compact({
    preferredUnits: entry.preferredUnits,
    unitAliases: entry.unitAliases,
    fhirCode: entry.fhirCode,
    loincCode: entry.loincCode,
    openMHealthSchema: entry.openMHealthSchema,
    normalLow: entry.normalLow,
    normalHigh: entry.normalHigh,
    referenceRanges: entry.referenceRanges
  });
}

function optionalJsonValue(value: unknown): string | null {
  return value === undefined ? null : json(value);
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function requiredJson<T>(value: unknown): T {
  const parsed = optionalJson<T>(value);
  if (parsed === undefined) {
    throw new Error("DuckDB expected a required JSON value.");
  }
  return parsed;
}

function optionalJson<T = unknown>(value: unknown): T | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function optionalNumber(value: unknown): number | undefined {
  return value === null || value === undefined ? undefined : Number(value);
}

function profileFromRow(row: Record<string, unknown>): Profile {
  const profileProperties = optionalJson<Record<string, unknown>>(row.custom_properties) ?? {};
  return compact({
    id: row.id,
    displayName: row.display_name,
    birthYear: optionalNumber(row.birth_year),
    sex: row.sex,
    heightCm: optionalNumber(row.height_cm),
    bloodType: row.blood_type,
    goalSummary: row.goal_summary,
    ...profileProperties,
    units: row.units,
    updatedAt: isoTimestamp(row.updated_at)
  }) as unknown as Profile;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalTimestamp(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : isoTimestamp(value);
}

function isoTimestamp(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value !== "string") {
    throw new Error("DuckDB returned an invalid timestamp.");
  }
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  return new Date(/[zZ]|[+-]\d\d(?::?\d\d)?$/.test(normalized) ? normalized : `${normalized}Z`).toISOString();
}

function dateOnly(value: unknown): string {
  return isoTimestamp(value).slice(0, 10);
}

function compact<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function firstDifferencePath(expected: unknown, actual: unknown, path = "$" ): string {
  if (Object.is(expected, actual)) {
    return path;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) {
      return `${path}.length`;
    }
    for (let index = 0; index < expected.length; index += 1) {
      const difference = firstDifferencePath(expected[index], actual[index], `${path}[${index}]`);
      if (difference !== `${path}[${index}]`) {
        return difference;
      }
      if (!Object.is(expected[index], actual[index]) && canonicalJson(expected[index]) !== canonicalJson(actual[index])) {
        return difference;
      }
    }
    return path;
  }
  if (expected && actual && typeof expected === "object" && typeof actual === "object") {
    const expectedRecord = expected as Record<string, unknown>;
    const actualRecord = actual as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(expectedRecord), ...Object.keys(actualRecord)])].sort();
    for (const key of keys) {
      if (!(key in expectedRecord) || !(key in actualRecord)) {
        return `${path}.${key}`;
      }
      if (canonicalJson(expectedRecord[key]) !== canonicalJson(actualRecord[key])) {
        return firstDifferencePath(expectedRecord[key], actualRecord[key], `${path}.${key}`);
      }
    }
  }
  return path;
}

async function orderedRows(connection: duckdb.Connection, table: string): Promise<Array<Record<string, unknown>>> {
  return all(connection, `SELECT * EXCLUDE (ordinal) FROM ${table} ORDER BY ordinal;`);
}

async function insertRows(connection: duckdb.Connection, sql: string, rows: unknown[][]): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  const match = /^(INSERT(?: OR IGNORE)? INTO .+ VALUES )\(([^;]+)\);$/s.exec(sql);
  if (!match) {
    throw new Error("DuckDB bulk insert received an unsupported SQL shape.");
  }
  const columnCount = rows[0].length;
  if (columnCount < 1 || rows.some((row) => row.length !== columnCount)) {
    throw new Error("DuckDB bulk insert rows must have a consistent positive column count.");
  }
  const maxChunkRows = Math.max(1, Math.floor(3_000 / columnCount));
  const maxChunkStringChars = 2_000_000;
  const rowPlaceholder = `(${match[2]})`;
  for (let index = 0; index < rows.length;) {
    const chunk: unknown[][] = [];
    let chunkStringChars = 0;
    while (index < rows.length && chunk.length < maxChunkRows) {
      const row = rows[index];
      const rowStringChars = row.reduce<number>(
        (total, value) => total + (typeof value === "string" ? value.length : 0),
        0
      );
      if (chunk.length > 0 && chunkStringChars + rowStringChars > maxChunkStringChars) {
        break;
      }
      chunk.push(row);
      chunkStringChars += rowStringChars;
      index += 1;
    }
    await run(
      connection,
      `${match[1]}${Array.from({ length: chunk.length }, () => rowPlaceholder).join(", ")};`,
      ...chunk.flat()
    );
  }
}

async function insertObservationRows(
  connection: duckdb.Connection,
  observations: Observation[],
  firstOrdinal: number
): Promise<void> {
  const chunkSize = 50;
  for (let index = 0; index < observations.length; index += chunkSize) {
    const chunk = observations.slice(index, index + chunkSize).map((entry, chunkIndex) => ({
      ordinal: firstOrdinal + index + chunkIndex,
      id: entry.id,
      measurementCode: entry.measurementCode,
      observedAt: entry.observedAt,
      effectiveStart: entry.effectiveStart ?? null,
      effectiveEnd: entry.effectiveEnd ?? null,
      value: entry.value,
      unit: entry.unit,
      sourceId: entry.sourceId,
      observationGroupId: entry.observationGroupId ?? null,
      deviceId: entry.deviceId ?? null,
      note: entry.note ?? null,
      sourceJsonPresent: entry.sourceJson !== undefined,
      sourceJson: optionalJsonValue(entry.sourceJson)
    }));
    await run(
      connection,
      `INSERT OR IGNORE INTO observations
      SELECT
        CAST(value->>'ordinal' AS BIGINT), value->>'id', value->>'measurementCode',
        CAST(value->>'observedAt' AS TIMESTAMP), CAST(value->>'effectiveStart' AS TIMESTAMP),
        CAST(value->>'effectiveEnd' AS TIMESTAMP), CAST(value->>'value' AS DOUBLE), value->>'unit',
        value->>'sourceId', value->>'observationGroupId', value->>'deviceId', value->>'note',
        CAST(value->>'sourceJsonPresent' AS BOOLEAN), CAST(value->>'sourceJson' AS JSON)
      FROM json_each(?);`,
      JSON.stringify(chunk)
    );
  }
}

function exec(connection: duckdb.Connection, sql: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    connection.exec(sql, (error) => error ? reject(error) : resolvePromise());
  });
}

function run(connection: duckdb.Connection, sql: string, ...params: unknown[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    connection.run(sql, ...params, (error) => error ? reject(error) : resolvePromise());
  });
}

function all(connection: duckdb.Connection, sql: string): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolvePromise, reject) => {
    connection.all(sql, (error, rows) => error ? reject(error) : resolvePromise((rows ?? []) as Array<Record<string, unknown>>));
  });
}

function allWithParams(
  connection: duckdb.Connection,
  sql: string,
  ...params: unknown[]
): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolvePromise, reject) => {
    connection.all(sql, ...params, (error, rows) =>
      error ? reject(error) : resolvePromise((rows ?? []) as Array<Record<string, unknown>>));
  });
}

function withStoredJson(
  value: Record<string, unknown>,
  present: unknown,
  storedJson: unknown
): Record<string, unknown> {
  if (!Boolean(present)) {
    return value;
  }
  return {
    ...value,
    sourceJson: storedJson === null || storedJson === undefined ? null : optionalJson(storedJson)
  };
}

type OrderedTable =
  | "imports"
  | "sources"
  | "observations"
  | "observation_groups"
  | "time_series_samples"
  | "activities"
  | "insights"
  | "audit_events";

export interface DuckDbDailyMetric {
  day: string;
  measurementCode: string;
  avgValue: number;
  minValue: number;
  maxValue: number;
  count: number;
  unit: string;
}

export interface DuckDbWeeklyMetric extends Omit<DuckDbDailyMetric, "day"> {
  weekStart: string;
}

export interface DuckDbMeasurementValue {
  kind: "observation" | "sample";
  id: string;
  timestamp: string;
  value: number;
  unit: string;
}

export interface DuckDbActivityQuery {
  startDate: string;
  endDate: string;
  sort?: "asc" | "desc";
  limit?: number;
}

export interface DuckDbActivity {
  activityType: string;
  startAt: string;
  endAt?: string;
  durationMinutes?: number;
  energyKcal?: number;
  distanceMeters?: number;
}

export interface DuckDbActivityCount {
  activityType: string;
  count: number;
}

export type DuckDbImport = ProfileImport;

const maxRawImportChars = 1_000_000;
const maxObservations = 250_000;
const maxTimeSeriesSamples = 10_000;
const minPerMeasurementCode = 500;
const maxActivitySessions = 75_000;
const maxObservationGroups = 20_000;
const maxAnalyticalRows = 200;

interface NormalizedActivityQuery {
  startDate: string;
  endDate: string;
  sort: "ASC" | "DESC";
  limit: number;
}

function normalizeActivityQuery(options: DuckDbActivityQuery): NormalizedActivityQuery {
  const startDate = validDateOnly(options.startDate, "startDate");
  const endDate = validDateOnly(options.endDate, "endDate");
  if (startDate > endDate) {
    throw new Error("DuckDB activity query startDate must not be after endDate.");
  }
  const requestedLimit = options.limit ?? maxAnalyticalRows;
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
    throw new Error("DuckDB activity query limit must be a positive integer.");
  }
  return {
    startDate,
    endDate,
    sort: options.sort === "asc" ? "ASC" : "DESC",
    limit: Math.min(requestedLimit, maxAnalyticalRows)
  };
}

function validDateOnly(value: string, name: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`DuckDB activity query ${name} must be a valid YYYY-MM-DD date.`);
  }
  return value;
}

function sanitizeSourceImport(sourceImport: SourceImport): SourceImport {
  if (!sourceImport.rawContent || sourceImport.rawContent.length <= maxRawImportChars) {
    return sourceImport;
  }
  return { ...sourceImport, rawContent: sourceImport.rawContent.slice(0, maxRawImportChars) };
}

function appendUniqueById<T extends { id: string }>(existing: T[], additions: T[]): T[] {
  const seen = new Set(existing.map((entry) => entry.id));
  return [...existing, ...additions.filter((entry) => {
    if (seen.has(entry.id)) {
      return false;
    }
    seen.add(entry.id);
    return true;
  })];
}

function limitByNewest<T>(
  items: T[],
  maxItems: number,
  key: (item: T) => string,
  groupKey?: (item: T) => string,
  minPerGroup = 0
): T[] {
  if (items.length <= maxItems) {
    return items;
  }
  if (!groupKey || minPerGroup <= 0) {
    return [...items].sort((left, right) => key(right).localeCompare(key(left))).slice(0, maxItems);
  }
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groupKey(item) || "unknown";
    groups.set(group, [...(groups.get(group) ?? []), item]);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => key(right).localeCompare(key(left)));
  }
  const selected: T[] = [];
  for (const group of groups.values()) {
    selected.push(...group.slice(0, minPerGroup));
    if (selected.length >= maxItems) {
      return selected.sort((left, right) => key(right).localeCompare(key(left))).slice(0, maxItems);
    }
  }
  const remainder = [...groups.values()]
    .flatMap((group) => group.slice(minPerGroup))
    .sort((left, right) => key(right).localeCompare(key(left)));
  return [...selected, ...remainder.slice(0, maxItems - selected.length)];
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function observationDeleteDetail(observation: Observation): string {
  return `Observation ${observation.measurementCode} deleted at ${observation.observedAt} (${observation.value} ${observation.unit}).`;
}

function insightFromRow(row: Record<string, unknown>): HealthStoreData["insights"][number] {
  return {
    id: String(row.id),
    createdAt: isoTimestamp(row.created_at),
    title: String(row.title),
    body: String(row.body),
    evidence: requiredJson(row.evidence),
    confidence: row.confidence,
    model: row.model,
    safetyNotice: String(row.safety_notice)
  } as HealthStoreData["insights"][number];
}