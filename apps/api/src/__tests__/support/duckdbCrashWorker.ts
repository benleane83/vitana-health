import { createDuckDbHealthStoreFixture } from "./duckdbFixture.js";
import { DuckDbRepository } from "../../storage/duckdbRepository.js";

const [mode, root, databasePath, key, httpfsExtensionPath] = process.argv.slice(2);
if (!mode || !root || !databasePath || !key || !httpfsExtensionPath) {
  throw new Error("DuckDB crash worker requires mode, root, database path, key, and extension path.");
}

const pause = async (): Promise<void> => {
  process.stdout.write("READY\n");
  await new Promise<void>(() => undefined);
};

if (mode === "hydrate") {
  await DuckDbRepository.hydrate(root, databasePath, key, createDuckDbHealthStoreFixture(), {
    httpfsExtensionPath,
    testHooks: { beforeHydrationPromotion: pause }
  });
} else if (mode === "delete") {
  const repository = await DuckDbRepository.open(root, databasePath, key, {
    httpfsExtensionPath,
    testHooks: { beforeTransactionCommit: pause }
  });
  try {
    await repository.deleteObservation("observation-z");
  } finally {
    await repository.close();
  }
} else {
  throw new Error(`Unsupported DuckDB crash worker mode: ${mode}.`);
}