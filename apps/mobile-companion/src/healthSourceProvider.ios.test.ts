import { describe, expect, it } from "vitest";
import {
  activeHealthSourceProvider,
  availableHealthSourceCategories
} from "./healthSourceProvider.ios";

describe("iOS health source provider", () => {
  it("does not expose a health sync provider before HealthKit is implemented", () => {
    expect(activeHealthSourceProvider()).toBeUndefined();
    expect(availableHealthSourceCategories()).toEqual([]);
  });
});