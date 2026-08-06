import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  InactiveEntitlementService,
  PURCHASE_GATING_ENABLED,
  StoreEntitlementService,
  createEntitlementStore,
  type BillingClient,
  type BillingError,
  type BillingPurchase,
  type EntitlementStore
} from "./entitlementService";
import { VITANA_PRO_PRODUCT_ID } from "@vitana/shared";
import * as SecureStore from "expo-secure-store";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY"
}));

const completedPurchase: BillingPurchase = {
  productId: VITANA_PRO_PRODUCT_ID,
  state: "purchased",
  needsFinish: true,
  nativePurchase: {}
};

class FakeBillingClient implements BillingClient {
  purchases: BillingPurchase[] = [];
  connectError?: Error;
  onPurchase?: (purchase: BillingPurchase) => void;
  onError?: (error: BillingError) => void;
  requestPurchase = vi.fn(async () => undefined);
  finishPurchase = vi.fn(async () => undefined);
  disconnect = vi.fn(async () => undefined);

  async connect(onPurchase: (purchase: BillingPurchase) => void, onError: (error: BillingError) => void) {
    if (this.connectError) throw this.connectError;
    this.onPurchase = onPurchase;
    this.onError = onError;
  }

  async queryPurchases() {
    return this.purchases;
  }
}

describe("store entitlement service", () => {
  let billing: FakeBillingClient;
  let tier: "free" | "pro";
  let store: EntitlementStore;

  beforeEach(() => {
    billing = new FakeBillingClient();
    tier = "free";
    store = {
      loadTier: vi.fn(async () => tier),
      saveTier: vi.fn(async (nextTier) => { tier = nextTier; })
    };
  });

  it("stays locked when no purchase exists", async () => {
    const service = new StoreEntitlementService(billing, store);

    await service.initialize();

    expect(service.getState()).toEqual({ status: "locked", tier: "free" });
  });

  it("acknowledges a completed purchase before unlocking", async () => {
    const service = new StoreEntitlementService(billing, store);
    await service.initialize();

    billing.onPurchase?.(completedPurchase);
    await vi.waitFor(() => expect(service.getState()).toEqual({ status: "owned", tier: "pro" }));

    expect(billing.finishPurchase).toHaveBeenCalledWith(completedPurchase);
    expect(store.saveTier).toHaveBeenCalledWith("pro");
  });

  it("reports cancellation without unlocking", async () => {
    const service = new StoreEntitlementService(billing, store);
    await service.initialize();

    billing.onError?.({ code: "user-cancelled", message: "Cancelled" });

    expect(service.getState().status).toBe("cancelled");
    expect(store.saveTier).not.toHaveBeenCalled();
  });

  it("requests the permanent Vitana Pro product", async () => {
    const service = new StoreEntitlementService(billing, store);
    await service.initialize();

    await service.purchase();

    expect(billing.requestPurchase).toHaveBeenCalledWith(VITANA_PRO_PRODUCT_ID);
  });

  it("keeps a pending purchase locked and unacknowledged", async () => {
    const service = new StoreEntitlementService(billing, store);
    await service.initialize();

    billing.onPurchase?.({ ...completedPurchase, state: "pending" });

    expect(service.getState().status).toBe("pending");
    expect(billing.finishPurchase).not.toHaveBeenCalled();
    expect(store.saveTier).not.toHaveBeenCalled();
  });

  it("restores and acknowledges an existing purchase", async () => {
    const service = new StoreEntitlementService(billing, store);
    await service.initialize();
    billing.purchases = [completedPurchase];

    await service.restore();

    expect(service.getState()).toEqual({ status: "owned", tier: "pro" });
    expect(billing.finishPurchase).toHaveBeenCalledWith(completedPurchase);
  });

  it("keeps a previously restored entitlement during offline startup", async () => {
    tier = "pro";
    billing.connectError = new Error("offline");
    const service = new StoreEntitlementService(billing, store);

    await service.initialize();

    expect(service.getState()).toEqual({ status: "owned", tier: "pro" });
  });
});

describe("purchase gating", () => {
  it("is disabled until the release flag is enabled", () => {
    expect(PURCHASE_GATING_ENABLED).toBe(false);
  });

  it("keeps the free tier without connecting to the store", async () => {
    const service = new InactiveEntitlementService();

    await service.initialize();
    await service.purchase();
    await service.restore();

    expect(service.getState()).toEqual({ status: "locked", tier: "free" });
  });
});

describe("entitlement persistence", () => {
  it("stores the device tier in SecureStore", async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue("pro");
    const store = createEntitlementStore();

    await expect(store.loadTier()).resolves.toBe("pro");
    await store.saveTier("pro");

    expect(SecureStore.getItemAsync).toHaveBeenCalledWith("vitana.entitlement.v2");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      "vitana.entitlement.v2",
      "pro",
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
    );
  });
});
