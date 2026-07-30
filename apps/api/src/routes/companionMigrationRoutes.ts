import { Router } from "express";
import {
  mobileMigrationBatchAcknowledgementSchema,
  mobileMigrationBatchSchema,
  mobileMigrationCompletionRequestSchema,
  mobileMigrationReceiptSchema,
  mobileMigrationStartRequestSchema,
  mobileMigrationStartResponseSchema
} from "@vitana/shared";
import { sendJson } from "./sendJson.js";
import type { AuthorizationPrincipal } from "../requestPrincipal.js";
import { resolvePrincipalStore } from "../requestPrincipal.js";
import type { ProfileStoreManager } from "../storage/profileStoreManager.js";

export function makeCompanionMigrationRoutes(storeManager: ProfileStoreManager): Router {
  const router = Router();

  router.post("/", async (request, response, next) => {
    try {
      const principal = requireCompanion(response.locals.principal as AuthorizationPrincipal);
      const input = mobileMigrationStartRequestSchema.parse(request.body);
      const store = resolvePrincipalStore(storeManager, principal);
      sendJson(response.status(201), mobileMigrationStartResponseSchema, await store.startMobileMigration(principal.pairingId, input.manifest));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:sessionId/batches", async (request, response, next) => {
    try {
      const principal = requireCompanion(response.locals.principal as AuthorizationPrincipal);
      const batch = mobileMigrationBatchSchema.parse(request.body);
      if (batch.sessionId !== request.params.sessionId) throw requestError(400, "Migration session does not match the route.");
      const store = resolvePrincipalStore(storeManager, principal);
      sendJson(response, mobileMigrationBatchAcknowledgementSchema, await store.applyMobileMigrationBatch(principal.pairingId, batch));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:sessionId/complete", async (request, response, next) => {
    try {
      const principal = requireCompanion(response.locals.principal as AuthorizationPrincipal);
      const input = mobileMigrationCompletionRequestSchema.parse(request.body);
      if (input.sessionId !== request.params.sessionId) throw requestError(400, "Migration session does not match the route.");
      const store = resolvePrincipalStore(storeManager, principal);
      sendJson(response, mobileMigrationReceiptSchema, await store.completeMobileMigration(principal.pairingId, input.sessionId));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function requireCompanion(principal: AuthorizationPrincipal) {
  if (principal.kind !== "companion") throw requestError(403, "Standalone migration requires a paired companion.");
  return principal;
}

function requestError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}
