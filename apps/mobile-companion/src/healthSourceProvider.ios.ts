import {
  HEALTH_SOURCE_CATEGORIES,
  type HealthSourceCategory,
  type HealthSourceProvider
} from "@vitana/shared";

export function activeHealthSourceProvider(): HealthSourceProvider | undefined {
  return undefined;
}

export function availableHealthSourceCategories(): readonly HealthSourceCategory[] {
  return [];
}

export { HEALTH_SOURCE_CATEGORIES };