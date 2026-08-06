import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { VITANA_PRO_PRODUCT_ID } from "@vitana/shared";
import { makeEntitlementRoutes } from "../routes/entitlementRoutes.js";

describe("entitlement routes", () => {
  const app = express()
    .use(express.json())
    .use("/api/entitlement", makeEntitlementRoutes({
      get: () => ({ tier: "free", source: null, overridden: false })
    }));

  it("returns the device entitlement", async () => {
    const response = await request(app).get("/api/entitlement").expect(200);
    expect(response.body).toEqual({ tier: "free", source: null, overridden: false });
  });

  it("fails closed instead of accepting an unverified Play claim", async () => {
    const response = await request(app)
      .post("/api/entitlement/claim")
      .send({
        source: "google-play",
        productId: VITANA_PRO_PRODUCT_ID,
        purchaseToken: "token",
        signedPayload: "payload",
        signature: "signature"
      })
      .expect(503);

    expect(response.body.code).toBe("PURCHASE_GATING_DISABLED");
  });
});