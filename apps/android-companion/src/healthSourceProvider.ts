import { Platform } from "react-native";
import {
  HEALTH_SOURCE_CATEGORIES,
  type HealthSourceCategory,
  type HealthSourceProvider
} from "@vitana/shared";
import { HEALTH_CONNECT_DESCRIPTORS, syncHealthConnect } from "./syncHealthConnect";

/**
 * Health Connect behind the neutral provider contract.
 *
 * `categories` is derived from the descriptor table rather than restated, so a category can only
 * become selectable once something can actually read it. That is the invariant a second provider
 * has to satisfy too, and it is why screens read the list from here instead of from a constant.
 */
export const healthConnectProvider: HealthSourceProvider = {
  id: "health-connect",
  label: "Health Connect",
  categories: HEALTH_CONNECT_DESCRIPTORS.map((descriptor) => descriptor.category),
  sync: (endpointUrl, companionToken, profileId, publicKeyHash, options) =>
    syncHealthConnect(endpointUrl, companionToken, profileId, publicKeyHash, options)
};

/**
 * The provider for this device, or `undefined` where none is available.
 *
 * iOS returns `undefined` until a HealthKit provider exists, which is what lets the sync UI render
 * an honest "not available on this device" instead of offering a control that cannot work.
 */
export function activeHealthSourceProvider(): HealthSourceProvider | undefined {
  return Platform.OS === "android" ? healthConnectProvider : undefined;
}

/** Categories offered by the active provider, empty when the device has none. */
export function availableHealthSourceCategories(): readonly HealthSourceCategory[] {
  return activeHealthSourceProvider()?.categories ?? [];
}

export { HEALTH_SOURCE_CATEGORIES };
