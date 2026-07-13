import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { DuckDbPocRepository } from "../storage/duckdbPocRepository.js";

interface VictimConfig {
  engine: "duckdb" | "json";
  root: string;
  workingPath: string;
  key: string;
  httpfsExtensionPath: string;
}

const configPath = process.argv[2];
if (!configPath) {
  throw new Error("Benchmark restart victim requires a config-file path.");
}
const config = JSON.parse(readFileSync(configPath, "utf8")) as VictimConfig;
const pause = async (): Promise<void> => {
  process.stdout.write("READY\n");
  await new Promise<void>(() => undefined);
};

if (config.engine === "duckdb") {
  const repository = await DuckDbPocRepository.open(config.root, config.workingPath, config.key, {
    httpfsExtensionPath: config.httpfsExtensionPath,
    testHooks: { beforeTransactionCommit: pause }
  });
  await repository.deleteObservationRecord("observation-0000000");
} else {
  process.env.LFA_DATA_DIR = dirname(config.workingPath);
  process.env.LFA_SECRET = config.key;
  const { HealthStore } = await import("../store.js");
  new HealthStore({ profileId: "benchmark-profile", passphrase: config.key, securityMode: "env-secret" });
  await pause();
}