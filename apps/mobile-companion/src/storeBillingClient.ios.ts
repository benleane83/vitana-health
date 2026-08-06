import type { BillingClient } from "./entitlementService";

export function createStoreBillingClient(): BillingClient {
	return {
		async connect() {
			throw new Error("Store purchases are not available in this iOS build.");
		},
		async queryPurchases() {
			return [];
		},
		async requestPurchase() {
			throw new Error("Store purchases are not available in this iOS build.");
		},
		async finishPurchase() {},
		async disconnect() {}
	};
}