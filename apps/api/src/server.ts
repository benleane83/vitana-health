import { existsSync, readFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import os from "node:os";
import path from "node:path";
import { Bonjour } from "bonjour-service";
import { PairingStore } from "./pairing.js";
import { ProfileStoreManager } from "./store.js";
import { createApp } from "./createApp.js";
import { configureRuntimeSecurity } from "./security.js";

loadEnvironmentFiles();

function getLanIp(): string | null {
  const interfaces = os.networkInterfaces();
  for (const ifaceList of Object.values(interfaces)) {
    for (const iface of ifaceList ?? []) {
      if (!iface.internal && iface.family === "IPv4") {
        return iface.address;
      }
    }
  }
  return null;
}

export async function startServer(): Promise<Server> {
  const port = Number.parseInt(process.env.PORT ?? "4317", 10);
  const host = process.env.HOST ?? "127.0.0.1";
  const security = await configureRuntimeSecurity(host);
  const tlsEnabled = Boolean(security.tlsCertPath && security.tlsKeyPath);
  const isLoopback = host === "127.0.0.1" || host === "::1" || host === "localhost";
  const insecureLanDevelopment =
    process.env.LFA_ALLOW_INSECURE_HTTP === "1" && process.env.NODE_ENV !== "production";
  if (!isLoopback && !tlsEnabled && !insecureLanDevelopment) {
    throw new Error("Could not configure HTTPS for non-loopback API access.");
  }

  const storeManager = new ProfileStoreManager();
  const pairingStore = new PairingStore();
  const app = createApp(storeManager, pairingStore, {
    publicKeyHash: security.publicKeyHash,
    webRoot: process.env.LFA_WEB_ROOT
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
      console.log(`Local Fitness Advisor API listening at ${scheme}://${host}:${port}`);
      const lanIp = getLanIp();
      if (lanIp) console.log(`LAN address for companion pairing: ${scheme}://${lanIp}:${port}`);
      const bonjour = new Bonjour();
      bonjour.publish({ name: "Local Fitness Advisor", type: "local-fitness-advisor", port });
      process.on("exit", () => bonjour.destroy());
      resolve();
    });
  });
  return server;
}

const isMainModule = process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;
if (isMainModule) {
  startServer().catch((error) => {
    console.error(error);
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
    if (!existsSync(filePath)) {
      continue;
    }
    const file = readFileSync(filePath, "utf8");
    for (const rawLine of file.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      const equalsIndex = line.indexOf("=");
      if (equalsIndex <= 0) {
        continue;
      }
      const key = line.slice(0, equalsIndex).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }
      const rawValue = line.slice(equalsIndex + 1).trim();
      process.env[key] = stripOuterQuotes(rawValue);
    }
  }
}

function stripOuterQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
