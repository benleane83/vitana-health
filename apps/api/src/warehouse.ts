import { existsSync, mkdirSync, rmSync } from "node:fs";
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
  const targetPath = warehousePath;
  try {
    mkdirSync(dirname(targetPath), { recursive: true });
    if (existsSync(targetPath)) {
      rmSync(targetPath, { force: true });
    }
    db = new duckdb.Database(targetPath);
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

    for (const entry of store.sourceImports) {
      await run(
        conn,
        "INSERT INTO imports VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        entry.id,
        entry.sourceKind,
        entry.fileName,
        entry.importedAt,
        entry.parserVersion,
        entry.checksum,
        entry.rowCount,
        entry.status
      );
    }

    for (const entry of store.observations) {
      await run(
        conn,
        "INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
      );
    }

    for (const entry of store.timeSeriesSamples) {
      await run(
        conn,
        "INSERT INTO samples VALUES (?, ?, ?, ?, ?, ?, ?)",
        entry.id,
        entry.measurementCode,
        entry.startAt,
        entry.endAt,
        entry.value,
        entry.unit,
        entry.sourceId
      );
    }

    for (const entry of store.activitySessions) {
      await run(
        conn,
        "INSERT INTO activities VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        entry.id,
        entry.activityType,
        entry.startAt,
        entry.endAt ?? null,
        entry.durationMinutes ?? null,
        entry.energyKcal ?? null,
        entry.distanceMeters ?? null,
        entry.sourceId
      );
    }

    await exec(
      conn,
      `
      CREATE VIEW v_daily_metrics AS
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

    const result: WarehouseBuildResult = {
      databasePath: targetPath,
      engine: "duckdb",
      counts: {
        imports: importCount,
        observations: observationCount,
        samples: sampleCount,
        activities: activityCount
      }
    };


    activeWarehousePath = targetPath;

    return result;
  } catch (error) {
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
}

export async function runWarehouseQuery(sql: string): Promise<Array<Record<string, unknown>>> {
  try {
    const db = new duckdb.Database(activeWarehousePath);
    const conn = db.connect();
    const rows = await all(conn, sql);
    await closeConnection(conn);
    await closeDatabase(db);
    return rows;
  } catch {
    return [];
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
