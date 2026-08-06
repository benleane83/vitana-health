import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  InactiveEntitlementService,
  PURCHASE_GATING_ENABLED,
  SCAN_SYNC_PRODUCT_ID,
  StoreEntitlementService,
  type BillingClient,
  type BillingError,
  type BillingPurchase,
  type EntitlementStore
} from "./entitlementService";

vi.mock("@react-native-async-storage/async-storage", () => ({ default: {} }));

const completedPurchase: BillingPurchase = {
  productId: SCAN_SYNC_PRODUCT_ID,
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
  let owned: boolean;
  let store: EntitlementStore;

  beforeEach(() => {
    billing = new FakeBillingClient();
    owned = false;
    store = {
      loadOwned: vi.fn(async () => owned),
      saveOwned: vi.fn(async () => { owned = true; })
    };
  });

  it("stays locked when no purchase exists", async () => {
    const service = new StoreEntitlementService(billing, store);

    await service.initialize();

    expect(service.getState()).toEqual({ status: "locked" });
  });

  it("acknowledges a completed purchase before unlocking", async () => {
    const service = new StoreEntitlementService(billing, store);
    await service.initialize();

    billing.onPurchase?.(completedPurchase);
    await vi.waitFor(() => expect(service.getState()).toEqual({ status: "owned" }));

    expect(billing.finishPurchase).toHaveBeenCalledWith(completedPurchase);
    expect(store.saveOwned).toHaveBeenCalledOnce();
  });

  it("reports cancellation without unlocking", async () => {
    const service = new StoreEntitlementService(billing, store);
    await service.initialize();

    billing.onError?.({ code: "user-cancelled", message: "Cancelled" });

    expect(service.getState().status).toBe("cancelled");
    expect(store.saveOwned).not.toHaveBeenCalled();
  });

  it("keeps a pending purchase locked and unacknowledged", async () => {
    const service = new StoreEntitlementService(billing, store);
    await service.initialize();

    billing.onPurchase?.({ ...completedPurchase, state: "pending" });

    expect(service.getState().status).toBe("pending");
    expect(billing.finishPurchase).not.toHaveBeenCalled();
    expect(store.saveOwned).not.toHaveBeenCalled();
  });

  it("restores and acknowledges an existing purchase", async () => {
    const service = new StoreEntitlementService(billing, store);
    await service.initialize();
    billing.purchases = [completedPurchase];

    await service.restore();

    expect(service.getState()).toEqual({ status: "owned" });
    expect(billing.finishPurchase).toHaveBeenCalledWith(completedPurchase);
  });

  it("keeps a previously restored entitlement during offline startup", async () => {
    owned = true;
    billing.connectError = new Error("offline");
    const service = new StoreEntitlementService(billing, store);

    await service.initialize();

    expect(service.getState()).toEqual({ status: "owned" });
  });
});

describe("purchase gating", () => {
  it("is disabled until the release flag is enabled", () => {
    expect(PURCHASE_GATING_ENABLED).toBe(false);
  });

  it("leaves Scan and Sync available without connecting to the store", async () => {
    const service = new InactiveEntitlementService();

    await service.initialize();
    await service.purchase();
    await service.restore();

    expect(service.getState()).toEqual({ status: "owned" });
  });
});
