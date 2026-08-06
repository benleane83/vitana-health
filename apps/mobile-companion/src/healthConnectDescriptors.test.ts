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
vi.mock("expo-crypto", () => ({ getRandomBytesAsync: vi.fn() }));
vi.mock("expo-secure-store", () => ({}));
vi.mock("./pinnedFetch", () => ({ pinnedFetch: vi.fn() }));

import { HEALTH_SOURCE_CATEGORIES } from "@vitana/shared";
import { HEALTH_CONNECT_CATEGORIES } from "./endpointStore";
import { HEALTH_CONNECT_DESCRIPTORS } from "./syncHealthConnect.android";
import { healthConnectProvider } from "./healthSourceProvider.android";

describe("Health Connect collection descriptors", () => {
  it("defines descriptors only for selectable categories and offers each category once", () => {
    const descriptorCategories = HEALTH_CONNECT_DESCRIPTORS.map((descriptor) => descriptor.category);

    expect([...new Set(descriptorCategories)].sort()).toEqual([...HEALTH_CONNECT_CATEGORIES].sort());
    expect(new Set(healthConnectProvider.categories).size).toBe(healthConnectProvider.categories.length);
  });

  it("offers only categories from the shared vocabulary through the provider", () => {
    // A provider that invented its own spelling would sync data the PC cannot classify, and the
    // mismatch would only show up as silently dropped readings on the receiving end.
    expect(healthConnectProvider.categories.length).toBeGreaterThan(0);
    for (const category of healthConnectProvider.categories) {
      expect(HEALTH_SOURCE_CATEGORIES).toContain(category);
    }
  });

  it("keeps oxygen saturation in the percentage units returned by Health Connect", () => {
    const descriptor = HEALTH_CONNECT_DESCRIPTORS.find((entry) => entry.category === "OxygenSaturation") as {
      toPayload: (records: Array<{ time: string; percentage: number }>) => {
        oxygenSaturation: Array<{ value: number }>;
      };
    };

    const payload = descriptor.toPayload([{ time: "2026-07-17T08:00:00.000Z", percentage: 93 }]);

    expect(payload.oxygenSaturation[0]?.value).toBe(93);
  });

  it.each([
    ["ActiveCaloriesBurned", "activeCaloriesKcal"],
    ["TotalCaloriesBurned", "totalCaloriesKcal"]
  ] as const)("converts %s records to kilocalories", (category, payloadKey) => {
    const descriptor = HEALTH_CONNECT_DESCRIPTORS.find((entry) => entry.category === category) as unknown as {
      toPayload: (records: Array<{
        startTime: string;
        endTime: string;
        energy: { inCalories: number; inKilocalories: number };
      }>) => Record<string, Array<{ value: number }>>;
    };

    const payload = descriptor.toPayload([{
      startTime: "2026-07-17T00:00:00.000Z",
      endTime: "2026-07-18T00:00:00.000Z",
      energy: { inCalories: 2_345_600, inKilocalories: 2_345.6 }
    }]);

    expect(payload[payloadKey]?.[0]?.value).toBe(2_345.6);
  });
});
