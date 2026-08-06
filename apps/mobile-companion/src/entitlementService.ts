import AsyncStorage from "@react-native-async-storage/async-storage";

export const SCAN_SYNC_PRODUCT_ID = "scan_sync_unlock";
export const PURCHASE_GATING_ENABLED = false;

const OWNED_KEY = "vitana.entitlement.scan-sync";

export type EntitlementStatus = "checking" | "locked" | "purchasing" | "pending" | "cancelled" | "error" | "owned";

export interface EntitlementState {
  status: EntitlementStatus;
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
  loadOwned(): Promise<boolean>;
  saveOwned(): Promise<void>;
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
  private readonly state: EntitlementState = { status: "owned" };

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
  private state: EntitlementState = { status: "checking" };
  private readonly listeners = new Set<(state: EntitlementState) => void>();
  private connected = false;
  private cachedOwned = false;

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
    this.cachedOwned = await this.store.loadOwned();
    if (this.cachedOwned) this.setState({ status: "owned" });

    try {
      await this.ensureConnected();
      const purchase = this.findEntitlement(await this.billing.queryPurchases());
      if (purchase) await this.handlePurchase(purchase);
      else if (!this.cachedOwned) this.setState({ status: "locked" });
    } catch {
      if (!this.cachedOwned) {
        this.setState({
          status: "error",
          message: "The store is unavailable. Connect to the internet to check your purchase."
        });
      }
    }
  }

  async purchase(): Promise<void> {
    this.setState({ status: "purchasing" });
    try {
      await this.ensureConnected();
      await this.billing.requestPurchase(SCAN_SYNC_PRODUCT_ID);
    } catch (caught) {
      this.handleError(toBillingError(caught));
    }
  }

  async restore(): Promise<void> {
    this.setState({ status: "checking" });
    try {
      await this.ensureConnected();
      const purchase = this.findEntitlement(await this.billing.queryPurchases());
      if (purchase) await this.handlePurchase(purchase);
      else this.setState({ status: "locked", message: "No previous purchase was found." });
    } catch {
      this.setState({
        status: this.cachedOwned ? "owned" : "error",
        message: this.cachedOwned ? undefined : "Restore requires an internet connection."
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
    return purchases.find((purchase) => purchase.productId === SCAN_SYNC_PRODUCT_ID);
  }

  private async handlePurchase(purchase: BillingPurchase): Promise<void> {
    if (purchase.productId !== SCAN_SYNC_PRODUCT_ID) return;
    if (purchase.state === "pending") {
      this.setState({ status: "pending", message: "Your purchase is pending. Access will unlock after payment completes." });
      return;
    }
    if (purchase.state !== "purchased") return;

    try {
      if (purchase.needsFinish) await this.billing.finishPurchase(purchase);
      await this.store.saveOwned();
      this.cachedOwned = true;
      this.setState({ status: "owned" });
    } catch {
      this.setState({ status: "error", message: "The purchase completed, but could not be acknowledged. Try Restore purchase." });
    }
  }

  private handleError(error: BillingError): void {
    if (error.code === "user-cancelled") {
      this.setState({ status: "cancelled", message: "Purchase cancelled. Scan and Sync remain locked." });
    } else if (error.code === "pending" || error.code === "deferred-payment") {
      this.setState({ status: "pending", message: "Your purchase is pending. Access will unlock after payment completes." });
    } else {
      this.setState({ status: "error", message: error.message || "The purchase could not be completed." });
    }
  }

  private setState(state: EntitlementState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}

export function createEntitlementStore(): EntitlementStore {
  return {
    async loadOwned() {
      return (await AsyncStorage.getItem(OWNED_KEY)) === "true";
    },
    async saveOwned() {
      await AsyncStorage.setItem(OWNED_KEY, "true");
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
