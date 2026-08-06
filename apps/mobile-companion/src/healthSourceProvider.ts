import {
  HEALTH_SOURCE_CATEGORIES,
  type HealthSourceCategory,
  type HealthSourceProvider
} from "@vitana/shared";

/**
 * The provider for this device, or `undefined` where none is available.
 *
 * iOS returns `undefined` until a HealthKit provider exists, which is what lets the sync UI render
 * an honest "not available on this device" instead of offering a control that cannot work.
 */
export function activeHealthSourceProvider(): HealthSourceProvider | undefined {
  return undefined;
}

/** Categories offered by the active provider, empty when the device has none. */
export function availableHealthSourceCategories(): readonly HealthSourceCategory[] {
  return activeHealthSourceProvider()?.categories ?? [];
}

export { HEALTH_SOURCE_CATEGORIES };
