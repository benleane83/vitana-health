import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Bonjour } from "bonjour-service";
import { PairingStore } from "./pairing.js";
import { HealthStore } from "./store.js";
import { createApp } from "./createApp.js";

loadEnvironmentFiles();

const port = Number.parseInt(process.env.PORT ?? "4317", 10);
const host = process.env.HOST ?? "127.0.0.1";
const store = new HealthStore();
const pairingStore = new PairingStore();
const app = createApp(store, pairingStore);

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

app.listen(port, host, () => {
  console.log(`Local Fitness Advisor API listening at http://${host}:${port}`);
  const lanIp = getLanIp();
  if (lanIp) {
    console.log(`LAN address for companion pairing: http://${lanIp}:${port}`);
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
