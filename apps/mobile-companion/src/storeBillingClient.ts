import type { BillingClient } from "./entitlementService";

export function createStoreBillingClient(): BillingClient {
  return {
    async connect() {
      throw new Error("Store purchases require a native app build.");
    },
    async queryPurchases() {
      return [];
    },
    async requestPurchase() {
      throw new Error("Store purchases require a native app build.");
    },
    async finishPurchase() {},
    async disconnect() {}
  };
}