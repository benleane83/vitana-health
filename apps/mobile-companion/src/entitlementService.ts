import * as SecureStore from "expo-secure-store";
import { VITANA_PRO_PRODUCT_ID, type Tier } from "@vitana/shared";

export const PURCHASE_GATING_ENABLED = false;

const ENTITLEMENT_KEY = "vitana.entitlement.v2";

export type EntitlementStatus = "checking" | "locked" | "purchasing" | "pending" | "cancelled" | "error" | "owned";

export interface EntitlementState {
  status: EntitlementStatus;
  tier: Tier;
  message?: string;
}

export interface BillingPurchase {
  productId: string;
  state: "pending" | "purchased" | "unknown";
  needsFinish: boolean;
  nativePurchase: unknown;
}

export interface BillingError {
  code: string;
  message: string;
}

export interface BillingClient {
  connect(onPurchase: (purchase: BillingPurchase) => void, onError: (error: BillingError) => void): Promise<void>;
  queryPurchases(): Promise<BillingPurchase[]>;
  requestPurchase(productId: string): Promise<void>;
  finishPurchase(purchase: BillingPurchase): Promise<void>;
  disconnect(): Promise<void>;
}

export interface EntitlementStore {
  loadTier(): Promise<Tier>;
  saveTier(tier: Tier): Promise<void>;
}

export interface EntitlementService {
  getState(): EntitlementState;
  subscribe(listener: (state: EntitlementState) => void): () => void;
  initialize(): Promise<void>;
  purchase(): Promise<void>;
  restore(): Promise<void>;
  close(): Promise<void>;
}

export class InactiveEntitlementService implements EntitlementService {
  private readonly state: EntitlementState = { status: "locked", tier: "free" };

  getState(): EntitlementState {
    return this.state;
  }

  subscribe(listener: (state: EntitlementState) => void): () => void {
    listener(this.state);
    return () => {};
  }

  async initialize(): Promise<void> {}

  async purchase(): Promise<void> {}

  async restore(): Promise<void> {}

  async close(): Promise<void> {}
}

export class StoreEntitlementService implements EntitlementService {
  private state: EntitlementState = { status: "checking", tier: "free" };
  private readonly listeners = new Set<(state: EntitlementState) => void>();
  private connected = false;
  private cachedTier: Tier = "free";

  constructor(
    private readonly billing: BillingClient,
    private readonly store: EntitlementStore
  ) {}

  getState(): EntitlementState {
    return this.state;
  }

  subscribe(listener: (state: EntitlementState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  async initialize(): Promise<void> {
    this.cachedTier = await this.store.loadTier();
    if (this.cachedTier === "pro") this.setState({ status: "owned", tier: "pro" });

    try {
      await this.ensureConnected();
      const purchase = this.findEntitlement(await this.billing.queryPurchases());
      if (purchase) await this.handlePurchase(purchase);
      else if (this.cachedTier === "free") this.setState({ status: "locked", tier: "free" });
    } catch {
      if (this.cachedTier === "free") {
        this.setState({
          status: "error",
          tier: "free",
          message: "The store is unavailable. Connect to the internet to check your purchase."
        });
      }
    }
  }

  async purchase(): Promise<void> {
    this.setState({ status: "purchasing", tier: this.cachedTier });
    try {
      await this.ensureConnected();
      await this.billing.requestPurchase(VITANA_PRO_PRODUCT_ID);
    } catch (caught) {
      this.handleError(toBillingError(caught));
    }
  }

  async restore(): Promise<void> {
    this.setState({ status: "checking", tier: this.cachedTier });
    try {
      await this.ensureConnected();
      const purchase = this.findEntitlement(await this.billing.queryPurchases());
      if (purchase) await this.handlePurchase(purchase);
      else this.setState({ status: "locked", tier: "free", message: "No previous purchase was found." });
    } catch {
      this.setState({
        status: this.cachedTier === "pro" ? "owned" : "error",
        tier: this.cachedTier,
        message: this.cachedTier === "pro" ? undefined : "Restore requires an internet connection."
      });
    }
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    await this.billing.disconnect();
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    await this.billing.connect(
      (purchase) => { void this.handlePurchase(purchase); },
      (error) => this.handleError(error)
    );
    this.connected = true;
  }

  private findEntitlement(purchases: BillingPurchase[]): BillingPurchase | undefined {
    return purchases.find((purchase) => purchase.productId === VITANA_PRO_PRODUCT_ID);
  }

  private async handlePurchase(purchase: BillingPurchase): Promise<void> {
    if (purchase.productId !== VITANA_PRO_PRODUCT_ID) return;
    if (purchase.state === "pending") {
      this.setState({ status: "pending", tier: this.cachedTier, message: "Your purchase is pending. Access will unlock after payment completes." });
      return;
    }
    if (purchase.state !== "purchased") return;

    try {
      if (purchase.needsFinish) await this.billing.finishPurchase(purchase);
      await this.store.saveTier("pro");
      this.cachedTier = "pro";
      this.setState({ status: "owned", tier: "pro" });
    } catch {
      this.setState({ status: "error", tier: this.cachedTier, message: "The purchase completed, but could not be acknowledged. Try Restore purchase." });
    }
  }

  private handleError(error: BillingError): void {
    if (error.code === "user-cancelled") {
      this.setState({ status: "cancelled", tier: this.cachedTier, message: "Purchase cancelled. Vitana Pro remains locked." });
    } else if (error.code === "pending" || error.code === "deferred-payment") {
      this.setState({ status: "pending", tier: this.cachedTier, message: "Your purchase is pending. Access will unlock after payment completes." });
    } else {
      this.setState({ status: "error", tier: this.cachedTier, message: error.message || "The purchase could not be completed." });
    }
  }

  private setState(state: EntitlementState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}

export function createEntitlementStore(): EntitlementStore {
  return {
    async loadTier() {
      return (await SecureStore.getItemAsync(ENTITLEMENT_KEY)) === "pro" ? "pro" : "free";
    },
    async saveTier(tier) {
      await SecureStore.setItemAsync(ENTITLEMENT_KEY, tier, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
      });
    }
  };
}

function toBillingError(caught: unknown): BillingError {
  if (caught && typeof caught === "object") {
    const value = caught as { code?: unknown; message?: unknown };
    return {
      code: typeof value.code === "string" ? value.code : "unknown",
      message: typeof value.message === "string" ? value.message : "The purchase could not be completed."
    };
  }
  return { code: "unknown", message: "The purchase could not be completed." };
}
