import { describe, expect, it } from "vitest";
import { parsePairingPayload } from "./pairingPayload";

describe("pairing payload", () => {
  it("accepts the Vitana discriminator", () => {
    expect(parsePairingPayload(JSON.stringify({
      app: "vitana",
      url: "https://192.0.2.1:4317",
      pairingCode: "pairing-code",
      publicKeyHash: "fingerprint"
    }), true)).toEqual({
      url: "https://192.0.2.1:4317",
      pairingCode: "pairing-code",
      publicKeyHash: "fingerprint"
    });
  });

  it("rejects the retired discriminator", () => {
    expect(() => parsePairingPayload(JSON.stringify({
      app: ["local", "fitness", "advisor"].join("-"),
      url: "https://192.0.2.1:4317",
      pairingCode: "pairing-code",
      publicKeyHash: "fingerprint"
    }), true)).toThrow("This QR code is not a Vitana pairing code.");
  });
});
