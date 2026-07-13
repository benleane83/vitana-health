import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const require = createRequire(import.meta.url);
const duckdb = require("duckdb");
const duckdbPackage = require("duckdb/package.json");
const pinnedDuckDbVersion = "1.4.4";
const pinnedSha256ByPlatform = {
  windows_amd64: "21eea4547cf5aa5231f4838906e8935067c956f56a5efd09035a51189af8a77b"
};

if (duckdbPackage.version !== pinnedDuckDbVersion) {
  throw new Error(`Expected DuckDB ${pinnedDuckDbVersion}, found ${duckdbPackage.version}.`);
}

const platform = duckDbPlatform(process.platform, process.arch);
const pinnedSha256 = pinnedSha256ByPlatform[platform];
if (!pinnedSha256) {
  throw new Error(`No pinned DuckDB httpfs digest is configured for ${platform}.`);
}
const skipRuntimeVerification = process.argv.includes("--skip-runtime-verification");
const outputIndex = process.argv.indexOf("--output");
const outputDirectory = resolve(
  outputIndex >= 0 && process.argv[outputIndex + 1]
    ? process.argv[outputIndex + 1]
    : "apps/desktop/build/duckdb-extensions"
);
const extensionPath = resolve(outputDirectory, "httpfs.duckdb_extension");
const manifestPath = resolve(outputDirectory, "manifest.json");
const sourceUrl = `https://extensions.duckdb.org/v${pinnedDuckDbVersion}/${platform}/httpfs.duckdb_extension.gz`;

mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });

let extensionBytes;
if (existsSync(extensionPath) && sha256(readFileSync(extensionPath)) === pinnedSha256) {
  extensionBytes = readFileSync(extensionPath);
} else {
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Failed to download DuckDB httpfs extension: ${response.status} ${response.statusText}`);
  }
  extensionBytes = gunzipSync(Buffer.from(await response.arrayBuffer()));
  const downloadedSha256 = sha256(extensionBytes);
  if (downloadedSha256 !== pinnedSha256) {
    throw new Error(
      `DuckDB httpfs digest mismatch for ${platform}: expected ${pinnedSha256}, found ${downloadedSha256}.`
    );
  }
  const temporaryPath = `${extensionPath}.tmp`;
  writeFileSync(temporaryPath, extensionBytes, { mode: 0o600 });
  renameSync(temporaryPath, extensionPath);
}

if (!skipRuntimeVerification) {
  try {
    await verifySignedExtension(extensionPath, outputDirectory);
  } catch (error) {
    rmSync(extensionPath, { force: true });
    throw error;
  }
}

const extensionSha256 = sha256(extensionBytes);
writeFileSync(manifestPath, `${JSON.stringify({
  schemaVersion: 1,
  extension: "httpfs",
  duckdbVersion: pinnedDuckDbVersion,
  platform,
  sha256: extensionSha256,
  sourceUrl,
  signaturePolicy: "DuckDB core-signed only; verified whenever loaded"
}, null, 2)}\n`, { mode: 0o600 });

console.log(JSON.stringify({ extensionPath, manifestPath, platform, sha256: extensionSha256 }));

function duckDbPlatform(nodePlatform, nodeArchitecture) {
  const operatingSystem = {
    darwin: "osx",
    linux: "linux",
    win32: "windows"
  }[nodePlatform];
  const architecture = {
    arm64: "arm64",
    x64: "amd64"
  }[nodeArchitecture];
  if (!operatingSystem || !architecture) {
    throw new Error(`DuckDB httpfs is not prepared for ${nodePlatform}/${nodeArchitecture}.`);
  }
  return `${operatingSystem}_${architecture}`;
}

async function verifySignedExtension(path, extensionDirectory) {
  const database = await new Promise((resolvePromise, reject) => {
    const opened = new duckdb.Database(":memory:", {
      allow_community_extensions: "false",
      allow_unsigned_extensions: "false",
      autoinstall_known_extensions: "false",
      autoload_known_extensions: "false",
      extension_directory: extensionDirectory
    }, (error) => error ? reject(error) : resolvePromise(opened));
  });
  const connection = database.connect();
  try {
    await exec(connection, `LOAD '${sqlPath(path)}';`);
    const rows = await all(
      connection,
      "SELECT loaded FROM duckdb_extensions() WHERE extension_name = 'httpfs';"
    );
    if (rows.length !== 1 || rows[0]?.loaded !== true) {
      throw new Error("DuckDB did not report the staged httpfs extension as loaded.");
    }
  } finally {
    await close(connection, database);
  }
}

function sqlPath(path) {
  if (/['\0\r\n]/.test(path)) {
    throw new Error("DuckDB extension path contains unsupported characters.");
  }
  return path.replaceAll("\\", "/");
}

function exec(connection, sql) {
  return new Promise((resolvePromise, reject) => {
    connection.exec(sql, (error) => error ? reject(error) : resolvePromise());
  });
}

function all(connection, sql) {
  return new Promise((resolvePromise, reject) => {
    connection.all(sql, (error, rows) => error ? reject(error) : resolvePromise(rows ?? []));
  });
}

async function close(connection, database) {
  await new Promise((resolvePromise, reject) => {
    connection.close((error) => error ? reject(error) : resolvePromise());
  });
  await new Promise((resolvePromise, reject) => {
    database.close((error) => error ? reject(error) : resolvePromise());
  });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}