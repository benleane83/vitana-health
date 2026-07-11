import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createServer as createHttpsServer } from "node:https";
import os from "node:os";
import path from "node:path";
import { Bonjour } from "bonjour-service";
import { PairingStore } from "./pairing.js";
import { ProfileStoreManager } from "./store.js";
import { createApp } from "./createApp.js";

loadEnvironmentFiles();

const port = Number.parseInt(process.env.PORT ?? "4317", 10);
const host = process.env.HOST ?? "127.0.0.1";
const isLoopback = host === "127.0.0.1" || host === "::1" || host === "localhost";
if (!process.env.LFA_OWNER_TOKEN) {
  if (!isLoopback) {
    throw new Error("LFA_OWNER_TOKEN (at least 24 characters) is required when the API is exposed beyond loopback.");
  }
  process.env.LFA_OWNER_TOKEN = randomBytes(24).toString("base64url");
  console.log(`Development owner token: ${process.env.LFA_OWNER_TOKEN}`);
}
if (process.env.LFA_OWNER_TOKEN.length < 24) {
  throw new Error("LFA_OWNER_TOKEN must be at least 24 characters.");
}

const tlsCertPath = process.env.LFA_TLS_CERT;
const tlsKeyPath = process.env.LFA_TLS_KEY;
if (Boolean(tlsCertPath) !== Boolean(tlsKeyPath)) {
  throw new Error("LFA_TLS_CERT and LFA_TLS_KEY must be configured together.");
}
const tlsEnabled = Boolean(tlsCertPath && tlsKeyPath);
const insecureLanDevelopment =
  process.env.LFA_ALLOW_INSECURE_HTTP === "1" && process.env.NODE_ENV !== "production";
if (!isLoopback && !tlsEnabled && !insecureLanDevelopment) {
  throw new Error(
    "Non-loopback API access requires HTTPS. Configure LFA_TLS_CERT and LFA_TLS_KEY, or set LFA_ALLOW_INSECURE_HTTP=1 for development only."
  );
}

const storeManager = new ProfileStoreManager();
const pairingStore = new PairingStore();
const app = createApp(storeManager, pairingStore);

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

const scheme = tlsEnabled ? "https" : "http";
const server = tlsEnabled
  ? createHttpsServer(
      {
        cert: readFileSync(tlsCertPath!),
        key: readFileSync(tlsKeyPath!)
      },
      app
    )
  : app;

server.listen(port, host, () => {
  console.log(`Local Fitness Advisor API listening at ${scheme}://${host}:${port}`);
  const lanIp = getLanIp();
  if (lanIp) {
    console.log(`LAN address for companion pairing: ${scheme}://${lanIp}:${port}`);
  }
  const bonjour = new Bonjour();
  bonjour.publish({ name: "Local Fitness Advisor", type: "local-fitness-advisor", port });
  process.on("exit", () => bonjour.destroy());
});

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
