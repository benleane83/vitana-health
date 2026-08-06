import {
  HEALTH_SOURCE_CATEGORIES,
  type HealthSourceCategory,
  type HealthSourceProvider
} from "@vitana/shared";
import { HEALTH_CONNECT_DESCRIPTORS, syncHealthConnect } from "./syncHealthConnect.android";

export const healthConnectProvider: HealthSourceProvider = {
  id: "health-connect",
  label: "Health Connect",
  categories: [...new Set(HEALTH_CONNECT_DESCRIPTORS.map((descriptor) => descriptor.category))],
  sync: (endpointUrl, companionToken, profileId, publicKeyHash, options) =>
    syncHealthConnect(endpointUrl, companionToken, profileId, publicKeyHash, options)
};

export function activeHealthSourceProvider(): HealthSourceProvider {
  return healthConnectProvider;
}

export function availableHealthSourceCategories(): readonly HealthSourceCategory[] {
  return healthConnectProvider.categories;
}

export { HEALTH_SOURCE_CATEGORIES };