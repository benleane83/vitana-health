import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DesktopEntitlementStore } from "../entitlementStore.js";
import { VITANA_PRO_PRODUCT_ID } from "@vitana/shared";

describe("desktop entitlement store", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "vitana-entitlement-"));
    delete process.env.VITANA_ENTITLEMENT_OVERRIDE;
  });

  afterEach(() => {
    delete process.env.VITANA_ENTITLEMENT_OVERRIDE;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("defaults to the free tier and persists a device-wide Pro grant", () => {
    const store = new DesktopEntitlementStore(dataDir);
    expect(store.get()).toEqual({ tier: "free", source: null, overridden: false });

    store.save({
      version: 1,
      tier: "pro",
      grantedAt: "2026-08-06T00:00:00.000Z",
      source: {
        kind: "google-play",
        productId: VITANA_PRO_PRODUCT_ID,
        purchaseToken: "token",
        signedPayload: "payload",
        signature: "signature"
      }
    });

    expect(store.get()).toEqual({ tier: "pro", source: "google-play", overridden: false });
    expect(JSON.parse(readFileSync(join(dataDir, "entitlement.json"), "utf8"))).toMatchObject({ tier: "pro" });
    if (process.platform !== "win32") expect(statSync(join(dataDir, "entitlement.json")).mode & 0o777).toBe(0o600);
  });

  it("honors the non-persistent entitlement override", () => {
    process.env.VITANA_ENTITLEMENT_OVERRIDE = "pro";
    expect(new DesktopEntitlementStore(dataDir).get()).toEqual({ tier: "pro", source: null, overridden: true });
  });
});