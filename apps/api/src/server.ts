import { existsSync, readFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import path from "node:path";
import { PairingStore } from "./pairing.js";
import {
  hasDuckDbActivationManifest,
  ProfileStoreManager,
  type StoreSecurityConfig
} from "./storage/profileStoreManager.js";
import { createApp } from "./createApp.js";
import { configureRuntimeSecurity } from "./security.js";
import { validateEnv } from "./env.js";
import { getLanIp } from "./netutil.js";
import { log } from "./logger.js";
import type { DesktopRuntimeSettingsResponse, DesktopRuntimeSettingsUpdate, DesktopUpdateState } from "@vitana/shared";

export { configureAiCredentialProtector } from "./aiSettings.js";
export { configureOwnerTokenProtector } from "./security.js";

loadEnvironmentFiles();

export interface StartServerOptions {
  storeSecurity?: StoreSecurityConfig;
  dynamicLanExposure?: boolean;
  desktopRuntimeController?: {
    getSettings: () => Promise<DesktopRuntimeSettingsResponse> | DesktopRuntimeSettingsResponse;
    updateSettings: (settings: DesktopRuntimeSettingsUpdate) => Promise<DesktopRuntimeSettingsResponse> | DesktopRuntimeSettingsResponse;
  };
  desktopUpdaterController?: {
    getState: () => DesktopUpdateState;
    check: () => Promise<DesktopUpdateState>;
    download: () => Promise<DesktopUpdateState>;
    restartToInstall: () => Promise<DesktopUpdateState>;
  };
}

export type RunningServer = Server & {
  shutdown: () => Promise<void>;
  currentHost: () => string;
  certificateFingerprint: string | null;
};

export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  // Fail fast on misconfigured environment before touching any port or file
  const env = validateEnv();

  const port = env.PORT;
  const host = env.HOST;
  const dynamicLanExposure = options.dynamicLanExposure === true;
  const security = await configureRuntimeSecurity(host, { requireTls: dynamicLanExposure });
  const tlsEnabled = Boolean(security.tlsCertPath && security.tlsKeyPath);
  const isLoopback = host === "127.0.0.1" || host === "::1" || host === "localhost";
  const insecureLanDevelopment =
    env.VITANA_ALLOW_INSECURE_HTTP === "1" && env.NODE_ENV !== "production";

  if (!isLoopback && !tlsEnabled && !insecureLanDevelopment) {
    throw new Error("Could not configure HTTPS for non-loopback API access.");
  }

  if (!env.VITANA_DUCKDB_HTTPFS_EXTENSION) {
    throw new Error("VITANA_DUCKDB_HTTPFS_EXTENSION is required for DuckDB storage.");
  }
  const activationState: "initialization" | "reopen" = hasDuckDbActivationManifest()
    ? "reopen"
    : "initialization";
  const storeManager = await ProfileStoreManager.open({
    security: options.storeSecurity,
    storageBackend: "duckdb",
    duckdb: { httpfsExtensionPath: env.VITANA_DUCKDB_HTTPFS_EXTENSION }
  });

  // Once storage is open every later failure - a port already in use, a missing TLS file, a bad
  // web root - must still release the DuckDB handles. Leaking them leaves the encrypted database
  // locked until the process dies, which on desktop means the next launch cannot open it either.
  let storageClosePromise: Promise<void> | undefined;
  const closeStorage = (): Promise<void> => {
    storageClosePromise ??= storeManager.closeAll().catch((error) => {
      log.error(`Failed to close health storage: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    });
    return storageClosePromise;
  };

  try {
    const profiles = storeManager.listProfiles();
    const activeProfileId = storeManager.getActiveProfileId();
    log.info("Health storage runtime ready.", {
      code: "storage-runtime-ready",
      storageBackend: storeManager.getStorageBackend(),
      profileCount: profiles.length,
      activeProfileId,
      activationState
    });
    const pairingStore = new PairingStore();
    const browserOrigin = `${tlsEnabled ? "https" : "http"}://127.0.0.1:${port}`;
    const app = createApp(storeManager, pairingStore, {
      publicKeyHash: security.publicKeyHash,
      webRoot: env.VITANA_WEB_ROOT,
      localAuthNonce: env.VITANA_LOCAL_AUTH_NONCE,
      openRouterCallbackOrigin: browserOrigin,
      allowedBrowserOrigins: [browserOrigin],
      desktopRuntimeController: options.desktopRuntimeController,
      desktopUpdaterController: options.desktopUpdaterController
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

    let listeningHost = dynamicLanExposure && pairingStore.requiresLanExposure()
      ? "0.0.0.0"
      : host;

    const listen = (targetHost: string): Promise<void> => new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, targetHost, () => {
        server.off("error", reject);
        listeningHost = targetHost;
        log.info(`Vitana API listening at ${scheme}://${targetHost}:${port}`);
        const lanIp = getLanIp();
        if (targetHost === "0.0.0.0" && lanIp) {
          log.info(`LAN address for companion pairing: ${scheme}://${lanIp}:${port}`);
        }
        resolve();
      });
    });

    const closeListener = (): Promise<void> => new Promise<void>((resolve, reject) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close((error) => error ? reject(error) : resolve());
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
    });

    await listen(listeningHost);

    let rebindQueue = Promise.resolve();
    if (dynamicLanExposure) {
      pairingStore.setLanExposureListener((required) => {
        const targetHost = required ? "0.0.0.0" : host;
        rebindQueue = rebindQueue.then(async () => {
          if (targetHost === listeningHost) return;
          const previousHost = listeningHost;
          await closeListener();
          try {
            await listen(targetHost);
          } catch (error) {
            log.error(`Could not rebind Vitana API to ${targetHost}: ${error instanceof Error ? error.message : String(error)}`);
            await listen(previousHost);
          }
        }).catch((error) => {
          log.error(`Vitana API listener transition failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      });
    }

    const runningServer = server as RunningServer;
    runningServer.currentHost = () => listeningHost;
    runningServer.certificateFingerprint = security.certificateFingerprint;
    runningServer.shutdown = async (): Promise<void> => {
      pairingStore.flushPendingWrites();
      await rebindQueue;
      await closeListener();
      await closeStorage();
    };

    const shutdown = async (signal: string): Promise<void> => {
      log.info(`Received ${signal} - shutting down gracefully`);
      const forceExit = setTimeout(() => {
        log.warn("Graceful shutdown timed out - forcing exit");
        process.exit(1);
      }, 10_000);
      forceExit.unref();
      try {
        await runningServer.shutdown();
        clearTimeout(forceExit);
        log.info("Server closed cleanly");
        process.exit(process.exitCode ?? 0);
      } catch (error) {
        log.error(`Error during shutdown: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    };

    process.once("SIGTERM", () => void shutdown("SIGTERM"));
    process.once("SIGINT", () => void shutdown("SIGINT"));

    return runningServer;
  } catch (error) {
    await closeStorage().catch(() => undefined);
    throw error;
  }
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
