import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { listPackage } = require("@electron/asar");

export function inspectLinuxDesktopPackage(unpackedDirectory) {
  const root = path.resolve(unpackedDirectory);
  const resources = path.join(root, "resources");
  const asarPath = path.join(resources, "app.asar");
  const extensionPath = path.join(resources, "duckdb-extensions", "httpfs.duckdb_extension");
  const manifestPath = path.join(resources, "duckdb-extensions", "manifest.json");
  for (const requiredPath of [asarPath, extensionPath, manifestPath]) {
    if (!existsSync(requiredPath)) throw new Error(`Packaged resource is missing: ${requiredPath}`);
  }

  const files = walk(root);
  const duckDbBindings = files.filter((file) => file.endsWith(`${path.sep}duckdb.node`));
  if (duckDbBindings.length !== 1) {
    throw new Error(`Expected one packaged DuckDB binding, found ${duckDbBindings.length}.`);
  }
  if (!readFileSync(duckDbBindings[0]).subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    throw new Error("The packaged DuckDB binding is not a Linux ELF binary.");
  }
  const windowsBinaries = files.filter((file) => /\.(?:dll|exe)$/i.test(file));
  if (windowsBinaries.length > 0) {
    throw new Error(`Windows binaries reached the Linux package: ${windowsBinaries.join(", ")}`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const extensionSha256 = sha256(readFileSync(extensionPath));
  if (
    manifest.platform !== "linux_amd64" ||
    manifest.sha256 !== extensionSha256 ||
    manifest.signaturePolicy !== "DuckDB core-signed only; verified whenever loaded"
  ) {
    throw new Error("The packaged Linux HTTPFS extension does not match its signed-extension manifest.");
  }

  const asarEntries = listPackage(asarPath);
  for (const requiredEntry of [
    "/node_modules/pdf-parse/",
    "/node_modules/pdfkit/",
    "/node_modules/tesseract.js-core/tesseract-core.wasm",
    "/node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz"
  ]) {
    if (!asarEntries.some((entry) => entry.startsWith(requiredEntry))) {
      throw new Error(`Required PDF/OCR resource is missing from app.asar: ${requiredEntry}`);
    }
  }

  return {
    unpackedDirectory: root,
    duckDbBinding: path.relative(root, duckDbBindings[0]),
    extensionSha256,
    extensionPlatform: manifest.platform,
    pdfOcrResourcesVerified: true,
    windowsBinariesFound: 0
  };
}

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const entryPath = path.join(directory, entry);
    if (statSync(entryPath).isDirectory()) files.push(...walk(entryPath));
    else files.push(entryPath);
  }
  return files;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const unpackedDirectory = process.argv[2];
  if (!unpackedDirectory) throw new Error("Usage: node inspect-linux-desktop-package.mjs <linux-unpacked-directory> [evidence-file]");
  const result = inspectLinuxDesktopPackage(unpackedDirectory);
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (process.argv[3]) writeFileSync(process.argv[3], serialized);
  process.stdout.write(serialized);
}
