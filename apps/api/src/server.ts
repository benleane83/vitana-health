import { existsSync, readFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import path from "node:path";
import { Bonjour } from "bonjour-service";
import { PairingStore } from "./pairing.js";
import { ProfileStoreManager } from "./store.js";
import { createApp } from "./createApp.js";
import { configureRuntimeSecurity } from "./security.js";
import { validateEnv } from "./env.js";
import { getLanIp } from "./netutil.js";
import { log } from "./logger.js";

loadEnvironmentFiles();

export async function startServer(): Promise<Server> {
  // Fail fast on misconfigured environment before touching any port or file
  const env = validateEnv();

  const port = env.PORT;
  const host = env.HOST;
  const security = await configureRuntimeSecurity(host);
  const tlsEnabled = Boolean(security.tlsCertPath && security.tlsKeyPath);
  const isLoopback = host === "127.0.0.1" || host === "::1" || host === "localhost";
  const insecureLanDevelopment =
    env.LFA_ALLOW_INSECURE_HTTP === "1" && env.NODE_ENV !== "production";

  if (!isLoopback && !tlsEnabled && !insecureLanDevelopment) {
    throw new Error("Could not configure HTTPS for non-loopback API access.");
  }

  const storeManager = new ProfileStoreManager();
  const pairingStore = new PairingStore();
  const app = createApp(storeManager, pairingStore, {
    publicKeyHash: security.publicKeyHash,
    webRoot: env.LFA_WEB_ROOT
  });

  const scheme = tlsEnabled ? "https" : "http";
  const server = tlsEnabled
    ? createHttpsServer(
        {
          cert: readFileSync(security.tlsCertPath!),
          key: readFileSync(security.tlsKeyPath!)
        },
        app
      )
    : createHttpServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      log.info(`Local Fitness Advisor API listening at ${scheme}://${host}:${port}`);
      const lanIp = getLanIp();
      if (lanIp) {
        log.info(`LAN address for companion pairing: ${scheme}://${lanIp}:${port}`);
      }
      const bonjour = new Bonjour();
      bonjour.publish({ name: "Local Fitness Advisor", type: "local-fitness-advisor", port });
      process.on("exit", () => bonjour.destroy());
      resolve();
    });
  });

  // Graceful shutdown: stop accepting connections and let in-flight requests drain
  function shutdown(signal: string): void {
    log.info(`Received ${signal} — shutting down gracefully`);
    server.close((err) => {
      if (err) {
        log.error(`Error during shutdown: ${err.message}`);
        process.exitCode = 1;
      } else {
        log.info("Server closed cleanly");
      }
      process.exit(process.exitCode ?? 0);
    });
    // Force-exit after 10 s if connections don't drain
    setTimeout(() => {
      log.warn("Graceful shutdown timed out — forcing exit");
      process.exit(1);
    }, 10_000).unref();
  }

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));

  return server;
}

const isMainModule =
  process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;
if (isMainModule) {
  startServer().catch((error) => {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

function loadEnvironmentFiles(): void {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "..", "..", ".env.local"),
    path.resolve(process.cwd(), "..", "..", ".env")
  ];

  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    const file = readFileSync(filePath, "utf8");
    for (const rawLine of file.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const equalsIndex = line.indexOf("=");
      if (equalsIndex <= 0) continue;
      const key = line.slice(0, equalsIndex).trim();
      if (!key || process.env[key] !== undefined) continue;
      const rawValue = line.slice(equalsIndex + 1).trim();
      process.env[key] = stripOuterQuotes(rawValue);
    }
  }
}

function stripOuterQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
