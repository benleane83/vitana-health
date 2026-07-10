import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync
} from "node:fs";
import { dirname, resolve } from "node:path";
import duckdb from "duckdb";
import type { HealthStoreData } from "@local-fitness-advisor/shared";

const dataDir = process.env.LFA_DATA_DIR ? resolve(process.env.LFA_DATA_DIR) : resolveDataDir();
const warehousePath = resolve(dataDir, "health-warehouse.duckdb");
let activeWarehousePath = warehousePath;

export interface WarehouseBuildResult {
  databasePath: string;
  engine: "duckdb" | "fallback";
  warning?: string;
  counts: {
    imports: number;
    observations: number;
    samples: number;
    activities: number;
  };
}

export async function rebuildWarehouseFromStore(store: HealthStoreData): Promise<WarehouseBuildResult> {
  let db: duckdb.Database | undefined;
  let conn: duckdb.Connection | undefined;
  let transactionStarted = false;
  const targetPath = warehousePath;
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  const backupPath = `${targetPath}.bak`;
  let builtTempDatabase = false;
  let swappedOldDatabase = false;
  let movedTempIntoPlace = false;
  try {
    mkdirSync(dirname(targetPath), { recursive: true });
    if (existsSync(tempPath)) {
      await removeFileWithRetry(tempPath);
    }
    db = new duckdb.Database(tempPath);
    conn = db.connect();

    await exec(conn, "PRAGMA threads=4;");
    await exec(conn, "DROP VIEW IF EXISTS v_weekly_metrics;");
    await exec(conn, "DROP VIEW IF EXISTS v_daily_metrics;");
    await exec(conn, "DROP TABLE IF EXISTS imports;");
    await exec(conn, "DROP TABLE IF EXISTS observations;");
    await exec(conn, "DROP TABLE IF EXISTS samples;");
    await exec(conn, "DROP TABLE IF EXISTS activities;");

    await exec(
      conn,
      `
      CREATE TABLE imports (
        id VARCHAR,
        source_kind VARCHAR,
        file_name VARCHAR,
        imported_at TIMESTAMP,
        parser_version VARCHAR,
        checksum VARCHAR,
        row_count BIGINT,
        status VARCHAR
      );

      CREATE TABLE observations (
        id VARCHAR,
        measurement_code VARCHAR,
        observed_at TIMESTAMP,
        effective_start TIMESTAMP,
        effective_end TIMESTAMP,
        value DOUBLE,
        unit VARCHAR,
        source_id VARCHAR,
        note VARCHAR,
        source_json VARCHAR
      );

      CREATE TABLE samples (
        id VARCHAR,
        measurement_code VARCHAR,
        start_at TIMESTAMP,
        end_at TIMESTAMP,
        value DOUBLE,
        unit VARCHAR,
        source_id VARCHAR
      );

      CREATE TABLE activities (
        id VARCHAR,
        activity_type VARCHAR,
        start_at TIMESTAMP,
        end_at TIMESTAMP,
        duration_minutes DOUBLE,
        energy_kcal DOUBLE,
        distance_meters DOUBLE,
        source_id VARCHAR
      );
      `
    );

    await exec(conn, "BEGIN TRANSACTION;");
    transactionStarted = true;

    await bulkInsert(
      conn,
      "imports",
      8,
      store.sourceImports.map((entry) => [
        entry.id,
        entry.sourceKind,
        entry.fileName,
        entry.importedAt,
        entry.parserVersion,
        entry.checksum,
        entry.rowCount,
        entry.status
      ])
    );

    await bulkInsert(
      conn,
      "observations",
      10,
      store.observations.map((entry) => [
        entry.id,
        entry.measurementCode,
        entry.observedAt,
        entry.effectiveStart ?? null,
        entry.effectiveEnd ?? null,
        entry.value,
        entry.unit,
        entry.sourceId,
        entry.note ?? null,
        entry.sourceJson ? JSON.stringify(entry.sourceJson) : null
      ])
    );

    await bulkInsert(
      conn,
      "samples",
      7,
      store.timeSeriesSamples.map((entry) => [
        entry.id,
        entry.measurementCode,
        entry.startAt,
        entry.endAt,
        entry.value,
        entry.unit,
        entry.sourceId
      ])
    );

    await bulkInsert(
      conn,
      "activities",
      8,
      store.activitySessions.map((entry) => [
        entry.id,
        entry.activityType,
        entry.startAt,
        entry.endAt ?? null,
        entry.durationMinutes ?? null,
        entry.energyKcal ?? null,
        entry.distanceMeters ?? null,
        entry.sourceId
      ])
    );

    await exec(conn, "COMMIT;");
    transactionStarted = false;

    await exec(
      conn,
      `
      CREATE VIEW v_daily_metrics AS
      WITH daily_source_metrics AS (
        SELECT
          DATE(observed_at) AS day,
          measurement_code,
          AVG(value) AS avg_value,
          MIN(value) AS min_value,
          MAX(value) AS max_value,
          COUNT(*) AS n,
          MIN(unit) AS unit
        FROM observations
        GROUP BY 1, 2
        UNION ALL
        SELECT
          DATE(start_at) AS day,
          measurement_code,
          CASE WHEN measurement_code = 'steps' THEN SUM(value) ELSE AVG(value) END AS avg_value,
          MIN(value) AS min_value,
          MAX(value) AS max_value,
          COUNT(*) AS n,
          MIN(unit) AS unit
        FROM samples
        GROUP BY 1, 2
      )
      SELECT
        day,
        measurement_code,
        SUM(avg_value * n) / NULLIF(SUM(n), 0) AS avg_value,
        MIN(min_value) AS min_value,
        MAX(max_value) AS max_value,
        SUM(n) AS n,
        MIN(unit) AS unit
      FROM daily_source_metrics
      GROUP BY 1, 2;
      `
    );

    await exec(
      conn,
      `
      CREATE VIEW v_weekly_metrics AS
      SELECT
        DATE_TRUNC('week', day) AS week_start,
        measurement_code,
        AVG(avg_value) AS avg_value,
        MIN(min_value) AS min_value,
        MAX(max_value) AS max_value,
        SUM(n) AS n,
        MIN(unit) AS unit
      FROM v_daily_metrics
      GROUP BY 1, 2;
      `
    );

    const [importCount, observationCount, sampleCount, activityCount] = await Promise.all([
      scalar(conn, "SELECT COUNT(*) AS c FROM imports"),
      scalar(conn, "SELECT COUNT(*) AS c FROM observations"),
      scalar(conn, "SELECT COUNT(*) AS c FROM samples"),
      scalar(conn, "SELECT COUNT(*) AS c FROM activities")
    ]);

    builtTempDatabase = true;
  } catch (error) {
    if (conn && transactionStarted) {
      await exec(conn, "ROLLBACK;").catch(() => undefined);
    }
    return {
      databasePath: targetPath,
      engine: "fallback",
      warning: error instanceof Error ? error.message : "Warehouse fallback engaged due to unknown error",
      counts: {
        imports: store.sourceImports.length,
        observations: store.observations.length,
        samples: store.timeSeriesSamples.length,
        activities: store.activitySessions.length
      }
    };
  } finally {
    if (conn) {
      await closeConnection(conn);
    }
    if (db) {
      await closeDatabase(db);
    }
  }

  if (!builtTempDatabase) {
    return {
      databasePath: targetPath,
      engine: "fallback",
      warning: "Warehouse rebuild did not complete.",
      counts: {
        imports: store.sourceImports.length,
        observations: store.observations.length,
        samples: store.timeSeriesSamples.length,
        activities: store.activitySessions.length
      }
    };
  }

  try {
    if (existsSync(backupPath)) {
      await removeFileWithRetry(backupPath);
    }

    if (existsSync(targetPath)) {
      await renameWithRetry(targetPath, backupPath);
      swappedOldDatabase = true;
    }

    await renameWithRetry(tempPath, targetPath);
    movedTempIntoPlace = true;
    fsyncPath(targetPath);
    fsyncPath(dirname(targetPath));

    activeWarehousePath = targetPath;

    const result: WarehouseBuildResult = {
      databasePath: targetPath,
      engine: "duckdb",
      counts: {
        imports: store.sourceImports.length,
        observations: store.observations.length,
        samples: store.timeSeriesSamples.length,
        activities: store.activitySessions.length
      }
    };

    return result;
  } catch (error) {
    if (!movedTempIntoPlace && existsSync(tempPath)) {
      await removeFileWithRetry(tempPath);
    }
    if (swappedOldDatabase && !existsSync(targetPath) && existsSync(backupPath)) {
      await renameWithRetry(backupPath, targetPath);
      activeWarehousePath = targetPath;
    }
    return {
      databasePath: targetPath,
      engine: "fallback",
      warning: error instanceof Error ? error.message : "Warehouse swap failed",
      counts: {
        imports: store.sourceImports.length,
        observations: store.observations.length,
        samples: store.timeSeriesSamples.length,
        activities: store.activitySessions.length
      }
    };
  }
}

export async function runWarehouseQuery(sql: string): Promise<Array<Record<string, unknown>>> {
  let db: duckdb.Database | undefined;
  let conn: duckdb.Connection | undefined;
  try {
    db = new duckdb.Database(activeWarehousePath, { access_mode: "READ_ONLY" });
    conn = db.connect();
    return await all(conn, sql);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown warehouse query error";
    throw new Error(`Warehouse query failed: ${message}`);
  } finally {
    if (conn) {
      await closeConnection(conn);
    }
    if (db) {
      await closeDatabase(db);
    }
  }
}

function exec(connection: duckdb.Connection, sql: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    connection.exec(sql, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolvePromise();
    });
  });
}

function run(connection: duckdb.Connection, sql: string, ...params: unknown[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    connection.run(sql, ...params, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolvePromise();
    });
  });
}

async function bulkInsert(
  connection: duckdb.Connection,
  tableName: string,
  columnCount: number,
  rows: unknown[][]
): Promise<void> {
  const chunkSize = Math.max(1, Math.floor(3000 / columnCount));
  const rowPlaceholder = `(${Array.from({ length: columnCount }, () => "?").join(", ")})`;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    if (chunk.length === 0) {
      continue;
    }
    const placeholders = Array.from({ length: chunk.length }, () => rowPlaceholder).join(", ");
    await run(connection, `INSERT INTO ${tableName} VALUES ${placeholders}`, ...chunk.flat());
  }
}

function all(connection: duckdb.Connection, sql: string): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolvePromise, reject) => {
    connection.all(sql, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolvePromise((rows ?? []) as Array<Record<string, unknown>>);
    });
  });
}

async function scalar(connection: duckdb.Connection, sql: string): Promise<number> {
  const rows = await all(connection, sql);
  const value = rows[0]?.c;
  return typeof value === "number" ? value : Number(value ?? 0);
}

function closeConnection(connection: duckdb.Connection): Promise<void> {
  return new Promise((resolvePromise) => {
    connection.close(() => resolvePromise());
  });
}

function closeDatabase(database: duckdb.Database): Promise<void> {
  return new Promise((resolvePromise) => {
    database.close(() => resolvePromise());
  });
}

function resolveDataDir(): string {
  const candidates = [
    resolve(process.cwd(), "data"),
    resolve(process.cwd(), "..", "..", "data")
  ];
  const existing = candidates.find((candidate) => existsSync(candidate));
  return existing ?? candidates[0];
}

function fsyncPath(path: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    fsyncSync(fd);
  } catch {
    // Best-effort durability: ignore fsync failures on unsupported filesystems.
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
  }
}

async function renameWithRetry(fromPath: string, toPath: string): Promise<void> {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      renameSync(fromPath, toPath);
      return;
    } catch (error) {
      if (!isTransientFsError(error) || attempt === maxAttempts) {
        throw error;
      }
      await delay(25 * attempt);
    }
  }
}

async function removeFileWithRetry(path: string): Promise<void> {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      rmSync(path, { force: true });
      return;
    } catch (error) {
      if (!isTransientFsError(error) || attempt === maxAttempts) {
        return;
      }
      await delay(25 * attempt);
    }
  }
}

function isTransientFsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "EBUSY" || error.code === "EPERM" || error.code === "EACCES")
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}
