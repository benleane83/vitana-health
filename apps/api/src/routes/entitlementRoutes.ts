import { Router } from "express";
import { googlePlayEntitlementClaimSchema } from "@vitana/shared";
import type { EntitlementReader } from "../entitlementStore.js";

export function makeEntitlementRoutes(store: EntitlementReader): Router {
  const router = Router();

  router.get("/", (_request, response) => {
    response.json(store.get());
  });

  router.post("/claim", (request, response) => {
    googlePlayEntitlementClaimSchema.parse(request.body ?? {});
    response.status(503).json({
      error: "Vitana Pro purchases are not active yet.",
      code: "PURCHASE_GATING_DISABLED"
    });
  });

  return router;
}