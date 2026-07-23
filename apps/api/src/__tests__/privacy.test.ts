import { describe, expect, it } from "vitest";
import { redactFreeText } from "../privacy.js";

describe("redactFreeText", () => {
  it("preserves ISO observation dates while redacting phone numbers", () => {
    const redacted = redactFreeText("Observed on 2026-07-23. Contact +1 425 555 0123.");

    expect(redacted).toContain("2026-07-23");
    expect(redacted).toContain("[redacted-phone]");
  });
});