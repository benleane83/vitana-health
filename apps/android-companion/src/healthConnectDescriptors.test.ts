import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("react-native-health-connect", () => ({
  SdkAvailabilityStatus: { SDK_AVAILABLE: "available" },
  getSdkStatus: vi.fn(),
  initialize: vi.fn(),
  readRecords: vi.fn(),
  requestPermission: vi.fn()
}));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {} }));
vi.mock("expo-secure-store", () => ({}));
vi.mock("./pinnedFetch", () => ({ pinnedFetch: vi.fn() }));

import { HEALTH_CONNECT_CATEGORIES } from "./endpointStore";
import { HEALTH_CONNECT_DESCRIPTORS } from "./syncHealthConnect";

describe("Health Connect collection descriptors", () => {
  it("defines exactly one descriptor for every selectable category", () => {
    const descriptorCategories = HEALTH_CONNECT_DESCRIPTORS.map((descriptor) => descriptor.category);

    expect(descriptorCategories).toHaveLength(HEALTH_CONNECT_CATEGORIES.length);
    expect(new Set(descriptorCategories).size).toBe(descriptorCategories.length);
    expect([...descriptorCategories].sort()).toEqual([...HEALTH_CONNECT_CATEGORIES].sort());
  });
});
