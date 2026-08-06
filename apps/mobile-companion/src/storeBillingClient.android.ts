import { Platform } from "react-native";
import {
  endConnection,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  type EventSubscription,
  type Purchase
} from "react-native-iap";
import type { BillingClient, BillingPurchase } from "./entitlementService";

export function createStoreBillingClient(): BillingClient {
  let subscriptions: EventSubscription[] = [];

  return {
    async connect(onPurchase, onError) {
      await initConnection();
      subscriptions = [
        purchaseUpdatedListener((purchase) => onPurchase(mapPurchase(purchase, true))),
        purchaseErrorListener(({ code, message }) => onError({ code, message }))
      ];
    },
    async queryPurchases() {
      const purchases = await getAvailablePurchases({
        onlyIncludeActiveItemsIOS: true,
        includeSuspendedAndroid: false
      });
      return purchases.map((purchase) => mapPurchase(
        purchase,
        Platform.OS === "android"
          && "isAcknowledgedAndroid" in purchase
          && purchase.isAcknowledgedAndroid !== true
      ));
    },
    async requestPurchase(productId) {
      await requestPurchase({
        request: {
          apple: { sku: productId },
          google: { skus: [productId] }
        },
        type: "in-app"
      });
    },
    async finishPurchase(purchase) {
      await finishTransaction({ purchase: purchase.nativePurchase as Purchase, isConsumable: false });
    },
    async disconnect() {
      for (const subscription of subscriptions) subscription.remove();
      subscriptions = [];
      await endConnection();
    }
  };
}

function mapPurchase(purchase: Purchase, needsFinish: boolean): BillingPurchase {
  return {
    productId: purchase.productId,
    state: purchase.purchaseState,
    needsFinish,
    nativePurchase: purchase
  };
}