import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EntitlementGrant, EntitlementResponse, Tier } from "@vitana/shared";

export interface EntitlementReader {
  get(): EntitlementResponse;
}

export class DesktopEntitlementStore implements EntitlementReader {
  private readonly dataPath: string;

  constructor(dataDir = process.env.VITANA_DATA_DIR ?? "data") {
    const resolvedDataDir = resolve(dataDir);
    mkdirSync(resolvedDataDir, { recursive: true });
    this.dataPath = resolve(resolvedDataDir, "entitlement.json");
  }

  get(): EntitlementResponse {
    const override = entitlementOverride();
    if (override) return { tier: override, source: null, overridden: true };

    const grant = this.readGrant();
    return {
      tier: grant?.tier ?? "free",
      source: grant?.source.kind ?? null,
      overridden: false
    };
  }

  save(grant: EntitlementGrant): void {
    const temporaryPath = `${this.dataPath}.tmp`;
    try {
      writeFileSync(temporaryPath, JSON.stringify(grant, null, 2), { encoding: "utf8", mode: 0o600 });
      renameSync(temporaryPath, this.dataPath);
    } catch (error) {
      rmSync(temporaryPath, { force: true });
      throw error;
    }
  }

  private readGrant(): EntitlementGrant | null {
    if (!existsSync(this.dataPath)) return null;
    try {
      const value = JSON.parse(readFileSync(this.dataPath, "utf8")) as Partial<EntitlementGrant>;
      if (value.version !== 1 || value.tier !== "pro" || !value.source || typeof value.grantedAt !== "string") {
        throw new Error("Invalid entitlement grant.");
      }
      return value as EntitlementGrant;
    } catch {
      throw new Error(`Could not read entitlement at ${this.dataPath}.`);
    }
  }
}

function entitlementOverride(): Tier | null {
  const value = process.env.VITANA_ENTITLEMENT_OVERRIDE;
  return value === "free" || value === "pro" ? value : null;
}