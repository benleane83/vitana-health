/**
 * Electron ABI gate for the DuckDB native binding.
 *
 * `build.npmRebuild` is false, so the `duckdb` prebuild that npm installs is compiled against
 * Node's module ABI and is never rebuilt for Electron. That works only while Electron's ABI
 * (`process.versions.modules`) still matches what the prebuild targets. Nothing in the test suite
 * catches a mismatch, because every other test runs under Node: the first symptom would be a
 * packaged app that installs cleanly and then fails to open any profile.
 *
 * This runs under `electron`, not `node`, and does the two things that actually prove the binding
 * is usable: load it, and execute a query through it.
 */
const productName = "DuckDB native binding";

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(`ABI gate failed: ${message}`);
  process.exit(1);
  throw new Error(message);
}

if (!process.versions.electron) {
  fail("this gate must run under Electron (`electron verify-native-abi.cjs`), not plain Node.");
}
if (process.env.ELECTRON_RUN_AS_NODE) {
  fail("ELECTRON_RUN_AS_NODE is set, which runs Electron's bundled Node and bypasses the ABI check.");
}

let duckdb;
try {
  duckdb = require("duckdb");
} catch (error) {
  fail(
    `${productName} did not load under Electron ${process.versions.electron} ` +
    `(module ABI ${process.versions.modules}). Rebuild the prebuild for this Electron version, or ` +
    `pin Electron back. Underlying error: ${error && error.message}`
  );
}

const database = new duckdb.Database(":memory:");
database.all("SELECT 42 AS answer", (error, rows) => {
  if (error) {
    fail(`${productName} loaded but could not execute a query: ${error.message}`);
  }
  if (!rows || Number(rows[0] && rows[0].answer) !== 42) {
    fail(`${productName} returned an unexpected result: ${JSON.stringify(rows)}`);
  }
  console.log(
    `ABI gate passed: ${productName} loaded and queried under Electron ${process.versions.electron} ` +
    `(module ABI ${process.versions.modules}).`
  );
  process.exit(0);
});
