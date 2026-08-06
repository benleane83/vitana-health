export const VITANA_PRO_PRODUCT_ID = "vitana_pro_unlock";

export type Tier = "free" | "pro";

export type ProFeature =
  | "extended-health-connect-history"
  | "ai-query"
  | "additional-profile-creation"
  | "track-calendar"
  | "track-body-trend";

export const PRO_FEATURE_GATING_ENABLED = false;

export type EntitlementSource =
  | {
      kind: "google-play";
      productId: typeof VITANA_PRO_PRODUCT_ID;
      purchaseToken: string;
      orderId?: string;
      signedPayload: string;
      signature: string;
    }
  | { kind: "app-store"; transactionId: string }
  | { kind: "license-key"; licenseId: string; signature: string }
  | { kind: "revenuecat"; appUserId: string; entitlementId: string };

export interface EntitlementGrant {
  version: 1;
  tier: Tier;
  source: EntitlementSource;
  grantedAt: string;
}

export function hasFeature(
  tier: Tier,
  _feature: ProFeature,
  gatingEnabled = PRO_FEATURE_GATING_ENABLED
): boolean {
  return !gatingEnabled || tier === "pro";
}

export function healthConnectSyncWindowForTier(
  tier: Tier,
  requestedDays: number,
  gatingEnabled = PRO_FEATURE_GATING_ENABLED
): number {
  return requestedDays > 30 && !hasFeature(tier, "extended-health-connect-history", gatingEnabled)
    ? 30
    : requestedDays;
}