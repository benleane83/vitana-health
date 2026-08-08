import express from "express";
import { z } from "zod";
import QRCode from "qrcode";
import type { PairingStore } from "../pairing.js";
import type { AuthorizationPrincipal } from "../createApp.js";
import {
  PAIRING_APP,
  pairedDeviceSchema,
  pairedDevicesResponseSchema,
  pairingMutationResponseSchema,
  pairingRequestResponseSchema,
  pairingStatusResponseSchema,
  pendingPairingsResponseSchema
} from "@vitana/shared";
import { sendJson } from "./sendJson.js";

export function makePairingRoutes(
  pairingStore: PairingStore,
  options: { publicKeyHash?: string | null; port: number; scheme: string; profileExists: (profileId: string) => boolean }
): express.Router {
  const router = express.Router();

  const pairingRequestSchema = z.object({
    deviceId: z.string().min(1).max(120),
    deviceName: z.string().min(1).max(80),
    pairingCode: z.string().min(8).max(120)
  });

  // QR code generation — owner-only (enforced in createApp auth middleware)
  router.get("/qr", async (_request, response, next) => {
    try {
      const { getLanIp } = await import("../netutil.js");
      const lanIp = getLanIp() ?? "127.0.0.1";
      const url = `${options.scheme}://${lanIp}:${options.port}`;
      const challenge = pairingStore.createChallenge();
      const params = new URLSearchParams({
        app: PAIRING_APP,
        url,
        pairingCode: challenge.code,
        expiresAt: challenge.expiresAt
      });
      if (options.publicKeyHash) params.set("publicKeyHash", options.publicKeyHash);
      const payload = `vitana://pair?${params.toString()}`;
      response.setHeader("cache-control", "no-store");
      const buffer = await QRCode.toBuffer(payload, { type: "png", width: 300, margin: 2 });
      response.setHeader("content-type", "image/png");
      response.send(buffer);
    } catch (error) {
      next(error);
    }
  });

  // Companion-initiated — no auth required before the auth middleware
  router.post("/request", (request, response) => {
    const parsed = pairingRequestSchema.parse(request.body ?? {});
    const result = pairingStore.request(parsed.deviceId, parsed.deviceName, parsed.pairingCode);
    if (!result) {
      response.status(401).json({ error: "Pairing code is invalid or expired.", code: "PAIRING_CODE_INVALID" });
      return;
    }
    sendJson(response.status(201), pairingRequestResponseSchema, {
      pairingId: result.record.id,
      status: result.record.status,
      pollingSecret: result.pollingSecret
    });
  });

  router.get("/status/:pairingId", (request, response) => {
    const pollingSecret = request.headers["x-pairing-secret"];
    if (typeof pollingSecret !== "string") {
      response.status(401).json({ error: "Pairing secret required.", code: "PAIRING_SECRET_REQUIRED" });
      return;
    }
    const result = pairingStore.getStatus(request.params.pairingId, pollingSecret);
    if (!result) {
      response.status(404).json({ error: "Pairing request not found.", code: "PAIRING_NOT_FOUND" });
      return;
    }
    sendJson(response, pairingStatusResponseSchema, { id: result.record.id, status: result.record.status, token: result.token });
  });

  // All routes below require owner token (enforced by auth middleware in createApp)
  router.get("/pending", (_request, response) => {
    const pending = pairingStore.getPending().map((r) => ({
      id: r.id,
      deviceId: r.deviceId,
      deviceName: r.deviceName,
      requestedAt: r.requestedAt
    }));
    sendJson(response, pendingPairingsResponseSchema, pending);
  });

  router.get("/devices", (_request, response) => {
    sendJson(response, pairedDevicesResponseSchema, pairingStore.listDevices());
  });

  const approvalSchema = z.object({ profileId: z.string().min(1).max(64) });
  router.post("/approve/:pairingId", (request, response) => {
    const parsed = approvalSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: "Request body must include a valid profileId.", code: "VALIDATION_ERROR" });
      return;
    }
    if (!options.profileExists(parsed.data.profileId)) {
      response.status(400).json({ error: "The selected profile does not exist.", code: "PROFILE_NOT_FOUND" });
      return;
    }
    const record = pairingStore.approve(request.params.pairingId, parsed.data.profileId);
    if (!record) {
      response.status(404).json({ error: "Pairing request not found or already resolved.", code: "PAIRING_NOT_FOUND" });
      return;
    }
    sendJson(response, pairingMutationResponseSchema, { id: record.id, status: record.status });
  });

  router.post("/deny/:pairingId", (request, response) => {
    const record = pairingStore.deny(request.params.pairingId);
    if (!record) {
      response.status(404).json({ error: "Pairing request not found or already resolved.", code: "PAIRING_NOT_FOUND" });
      return;
    }
    sendJson(response, pairingMutationResponseSchema, { id: record.id, status: record.status });
  });

  router.post("/revoke/:pairingId", (request, response) => {
    const record = pairingStore.revoke(request.params.pairingId);
    if (!record) {
      response.status(404).json({ error: "Paired device not found.", code: "DEVICE_NOT_FOUND" });
      return;
    }
    sendJson(response, pairedDeviceSchema, record);
  });

  router.post("/revoke-self", (_request, response) => {
    const principal = response.locals.principal as AuthorizationPrincipal;
    if (principal.kind !== "companion") {
      response.status(403).json({ error: "This operation requires a companion credential.", code: "CAPABILITY_REQUIRED" });
      return;
    }
    const record = pairingStore.revoke(principal.pairingId);
    if (!record) {
      response.status(401).json({ error: "Paired device not found.", code: "AUTH_REQUIRED" });
      return;
    }
    sendJson(response.status(200), pairingMutationResponseSchema, { id: record.id, status: "revoked" });
  });

  return router;
}
