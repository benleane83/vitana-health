/**
 * Application factory. Mounts middleware, auth, and feature routes.
 *
 * Central policy enforced here (not in individual route files):
 * - CORS restricted to local origins
 * - Body limits per route
 * - Rate limiting per route group
 * - Owner / companion token authentication
 * - Correlation ID attachment and request timing
 * - Safe, structured error responses with stable public codes
 *
 * Route domains are split into dedicated modules under ./routes/.
 */
import cors from "cors";
import express from "express";
import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { PairingStore } from "./pairing.js";
import { ProfileStoreManager } from "./store.js";
import { isLoopbackAddress } from "./netutil.js";
import { log, generateCorrelationId } from "./logger.js";
import { makePairingRoutes } from "./routes/pairingRoutes.js";
import { makeProfileRoutes, makeProfilesRoutes } from "./routes/profileRoutes.js";
import { makeImportRoutes } from "./routes/importRoutes.js";
import { makeQueryRoutes, makeLlmRoutes } from "./routes/queryRoutes.js";
import { makeDataRoutes } from "./routes/dataRoutes.js";
import { makeSettingsRoutes } from "./routes/settingsRoutes.js";
import { z } from "zod";

export interface AppOptions {
  publicKeyHash?: string | null;
  webRoot?: string;
  assertSafeCloudModelEndpoint?: (endpoint: string) => Promise<unknown>;
}

function decodeCookieToken(value: string | undefined): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function isOwnerOnlyPath(requestPath: string): boolean {
  return (
    requestPath === "/settings" ||
    requestPath.startsWith("/settings/") ||
    requestPath === "/pair/qr" ||
    requestPath === "/pairing/pending" ||
    requestPath === "/pairing/devices" ||
    /^\/pairing\/(approve|deny|revoke)\//.test(requestPath)
  );
}

function isOpenRouterCallback(request: express.Request): boolean {
  return request.method === "GET" && request.path === "/settings/ai/openrouter/callback";
}

export function createApp(
  storeManager: ProfileStoreManager,
  pairingStore: PairingStore,
  options: AppOptions = {}
): express.Application {
  const app = express();

  app.disable("x-powered-by");

  // Body limits — larger limits only on routes that require them
  app.use(["/api/import/body-composition/preview", "/api/import/blood-test/preview"], express.json({ limit: "20mb" }));
  app.use("/api/import/health-connect", express.json({ limit: "10mb" }));
  app.use(express.json({ limit: "1mb" }));

  // CORS — local browser origins only
  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        if (!origin || /^https?:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error("Only local browser origins are allowed."));
      }
    })
  );

  // Correlation IDs and request timing
  app.use((_request, response, next) => {
    const id = generateCorrelationId();
    (response as express.Response & { correlationId: string }).correlationId = id;
    response.setHeader("x-correlation-id", id);
    next();
  });

  const startTimes = new WeakMap<object, number>();
  app.use((request, response, next) => {
    startTimes.set(request, Date.now());
    response.on("finish", () => {
      const cid = (response as express.Response & { correlationId?: string }).correlationId;
      const durationMs = Date.now() - (startTimes.get(request) ?? Date.now());
      log.request({
        method: request.method,
        path: request.path,
        status: response.statusCode,
        durationMs,
        correlationId: cid
      });
    });
    next();
  });

  // Rate limiting
  const rateBuckets = new Map<string, { count: number; resetAt: number }>();
  function rateLimit(max: number, windowMs: number) {
    return (request: express.Request, response: express.Response, next: express.NextFunction): void => {
      const now = Date.now();
      if (rateBuckets.size > 5_000) {
        for (const [k, v] of rateBuckets) {
          if (v.resetAt <= now) rateBuckets.delete(k);
        }
      }
      const routeGroup = request.baseUrl || request.path.split("/").slice(0, 3).join("/");
      const key = `${request.ip}:${routeGroup}`;
      const current = rateBuckets.get(key);
      const bucket =
        !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
      bucket.count++;
      rateBuckets.set(key, bucket);
      response.setHeader("rate-limit-limit", String(max));
      response.setHeader("rate-limit-remaining", String(Math.max(0, max - bucket.count)));
      if (bucket.count > max) {
        response.setHeader("retry-after", String(Math.ceil((bucket.resetAt - now) / 1000)));
        response.status(429).json({ error: "Too many requests. Try again later.", code: "RATE_LIMITED" });
        return;
      }
      next();
    };
  }

  app.use(rateLimit(300, 60_000));
  app.use("/api/pairing", rateLimit(30, 60_000));
  app.use("/api/llm", rateLimit(10, 60_000));
  app.use("/api/settings", rateLimit(30, 60_000));
  app.use("/api/query", rateLimit(30, 60_000));

  function ownerTokenIsValid(request: express.Request): boolean {
    const configured = process.env.LFA_OWNER_TOKEN ?? "";
    const encodedCookieToken = request.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("lfa_owner="))
      ?.slice("lfa_owner=".length);
    const supplied =
      request.headers.authorization?.replace(/^Bearer\s+/i, "") ??
      decodeCookieToken(encodedCookieToken);
    const configuredBuffer = Buffer.from(configured);
    const suppliedBuffer = Buffer.from(supplied);
    return (
      configuredBuffer.length >= 24 &&
      configuredBuffer.length === suppliedBuffer.length &&
      timingSafeEqual(configuredBuffer, suppliedBuffer)
    );
  }

  // Local browser auth (loopback only, no token required on the same machine)
  app.post("/api/auth/local", (request, response) => {
    const address = request.socket.remoteAddress ?? "";
    const loopback = isLoopbackAddress(address);
    const origin = request.headers.origin;
    const localOrigin = !origin || /^https?:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin);
    if (!loopback || !localOrigin) {
      response
        .status(403)
        .json({ error: "Local desktop authentication is only available on this computer.", code: "AUTH_LOOPBACK_ONLY" });
      return;
    }
    const secure = request.protocol === "https";
    response.setHeader(
      "set-cookie",
      `lfa_owner=${encodeURIComponent(process.env.LFA_OWNER_TOKEN ?? "")}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${secure ? "; Secure" : ""}`
    );
    response.status(204).end();
  });

  // Minimal liveness endpoint — no model config, no store counts, no internals
  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      uptime: process.uptime()
    });
  });

  // Pairing bootstrap — unauthenticated so a companion can initiate pairing.
  // These two inline handlers must come BEFORE the /api auth middleware.
  const pairingRequestSchema = z.object({
    deviceId: z.string().min(1).max(120),
    deviceName: z.string().min(1).max(80),
    pairingCode: z.string().min(8).max(120)
  });

  app.post("/api/pairing/request", (request, response) => {
    try {
      const parsed = pairingRequestSchema.parse(request.body ?? {});
      const result = pairingStore.request(parsed.deviceId, parsed.deviceName, parsed.pairingCode);
      if (!result) {
        response.status(401).json({ error: "Pairing code is invalid or expired.", code: "PAIRING_CODE_INVALID" });
        return;
      }
      response.status(201).json({
        pairingId: result.record.id,
        status: result.record.status,
        pollingSecret: result.pollingSecret
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        response.status(400).json({ error: "Invalid pairing request.", code: "VALIDATION_ERROR" });
        return;
      }
      response.status(500).json({ error: "An internal error occurred.", code: "INTERNAL_ERROR" });
    }
  });

  app.get("/api/pairing/status/:pairingId", (request, response) => {
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
    response.json({ id: result.record.id, status: result.record.status, token: result.token });
  });

  // Auth middleware — all /api routes below require a valid credential
  app.use("/api", (request, response, next) => {
    const companionToken = request.headers["x-companion-token"];
    if (ownerTokenIsValid(request) || isOpenRouterCallback(request)) {
      next();
      return;
    }
    const ownerOnly = isOwnerOnlyPath(request.path);
    if (!ownerOnly && typeof companionToken === "string" && pairingStore.validateToken(companionToken)) {
      next();
      return;
    }
    response.setHeader("www-authenticate", ['Bearer', 'realm="Local Fitness Advisor"'].join(" "));
    response.status(401).json({
      error: ownerOnly
        ? "Owner credential required."
        : "Valid owner or companion credential required.",
      code: "AUTH_REQUIRED"
    });
  });

  // Authenticated pairing management (owner only)
  const pairingPort = Number.parseInt(process.env.PORT ?? "4317", 10);
  const pairingScheme = process.env.LFA_TLS_CERT && process.env.LFA_TLS_KEY ? "https" : "http";
  const pairingRouter = makePairingRoutes(pairingStore, {
    publicKeyHash: options.publicKeyHash,
    port: pairingPort,
    scheme: pairingScheme
  });
  app.use("/api/pair", pairingRouter);
  app.use("/api/pairing", pairingRouter);

  // Feature route modules
  app.use("/api/profile", makeProfileRoutes(storeManager));
  app.use("/api/profiles", makeProfilesRoutes(storeManager));
  app.use("/api/import", makeImportRoutes(storeManager));
  app.use("/api/query", makeQueryRoutes(storeManager));
  app.use("/api/llm", makeLlmRoutes(storeManager));
  app.use("/api/settings", makeSettingsRoutes({ assertSafeCloudEndpoint: options.assertSafeCloudModelEndpoint }));
  app.use("/api", makeDataRoutes(storeManager));

  // Static web serving
  if (options.webRoot && existsSync(options.webRoot)) {
    app.use(rateLimit(120, 60_000), express.static(options.webRoot));
    app.get("*", rateLimit(120, 60_000), (_request, response) =>
      response.sendFile(path.join(options.webRoot!, "index.html"))
    );
  }

  // Centralized error handler — safe public responses, no stack traces
  app.use(
    (
      error: unknown,
      request: express.Request,
      response: express.Response,
      _next: express.NextFunction
    ) => {
      const correlationId = (response as express.Response & { correlationId?: string }).correlationId;

      if (error instanceof z.ZodError) {
        const issueSummary = error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
          .join("; ");
        response.status(400).json({
          error: `Invalid request: ${issueSummary}`,
          code: "VALIDATION_ERROR",
          correlationId
        });
        return;
      }

      if (error instanceof Error) {
        const status =
          "status" in error && typeof error.status === "number" ? error.status : 500;

        if (status >= 500) {
          log.error(`${status} ${error.constructor?.name ?? "Error"}: ${error.message}`, {
            correlationId,
            method: request.method,
            path: request.path,
            status
          });
        }

        const publicMessage =
          status === 413
            ? "Request body is too large."
            : status >= 500
              ? "An internal error occurred."
              : error.message;

        response.status(status).json({
          error: publicMessage,
          code: status === 413 ? "PAYLOAD_TOO_LARGE" : status >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR",
          correlationId
        });
        return;
      }

      log.error("Unknown request error", { correlationId, method: request.method, path: request.path, msg: "Unknown error" });
      response.status(500).json({ error: "An internal error occurred.", code: "INTERNAL_ERROR", correlationId });
    }
  );

  return app;
}
