import cors from "cors";
import express from "express";
import { z } from "zod";
import os from "node:os";
import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import { PairingStore } from "./pairing.js";
import {
  buildBodyCompositionImportFromDraft,
  buildManualLabEntryImport,
  computeAnalytics,
  parseBodyCompositionText,
  parseBloodTestCsv,
  parseSamsungHealthCsv,
  type BodyCompositionDraftRow,
  type DeleteObservationResponse,
  type DeleteObservationsByTypeResponse,
  type Profile
} from "@local-fitness-advisor/shared";
import { HealthStore } from "./store.js";
import { generateInsight } from "./insights.js";
import { importSamsungJsonUpload } from "./samsungJsonImport.js";
import { healthConnectImportRequestSchema, parseHealthConnectImport } from "./healthConnectImport.js";
import { rebuildWarehouseFromStore, runWarehouseQuery } from "./warehouse.js";
import { planWarehouseQuery } from "./nlQuery.js";
import { callConfiguredModel, currentModelConfig } from "./modelClient.js";
import { planDataAnswer } from "./askData.js";
import { planStoreAnswer } from "./askStore.js";
import { summarizeMeasurementDetail, summarizeStoreData } from "./summary.js";
import { planAiQuery } from "./aiQueryPlanner.js";
import type { QueryDSL } from "./aiQueryPlanner.js";
import { compileQueryDSL, validateCompiledSql } from "./queryCompiler.js";
import { safetyNotice } from "@local-fitness-advisor/shared";
import { extractBodyCompositionText } from "./bodyCompositionExtract.js";

function getLanIp(): string | null {
  const interfaces = os.networkInterfaces();
  for (const ifaceList of Object.values(interfaces)) {
    for (const iface of ifaceList ?? []) {
      if (!iface.internal && iface.family === "IPv4") {
        return iface.address;
      }
    }
  }
  return null;
}

const pairingRequestSchema = z.object({
  deviceId: z.string().min(1).max(120),
  deviceName: z.string().min(1).max(80),
  pairingCode: z.string().min(8).max(120)
});

const profileSchema = z.object({
  displayName: z.string().min(1).max(80),
  birthYear: z.number().int().min(1900).max(new Date().getFullYear()).optional(),
  sex: z.enum(["female", "male", "intersex", "unknown", "not-specified"]).optional(),
  heightCm: z.number().positive().max(260).optional(),
  goalSummary: z.string().max(500).optional(),
  units: z.enum(["metric", "imperial"])
});

const importSchema = z.object({
  fileName: z.string().min(1).max(240),
  content: z.string().min(1)
});

const bodyCompositionPreviewSchema = z.object({
  fileName: z.string().min(1).max(240),
  mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  contentBase64: z.string().min(1).max(20_000_000)
});

const bodyCompositionDraftRowSchema = z.object({
  id: z.string().min(1).max(120),
  label: z.string().min(1).max(160),
  measurementCode: z.string().min(1).max(120),
  displayName: z.string().min(1).max(160),
  value: z.number().finite(),
  unit: z.string().min(1).max(32),
  observedAt: z.string().max(80).optional(),
  confidence: z.enum(["high", "medium", "low"]),
  sourceText: z.string().max(500).optional(),
  included: z.boolean(),
  generatedCode: z.boolean().optional()
});

const bodyCompositionCommitSchema = z.object({
  fileName: z.string().min(1).max(240),
  reportDate: z.string().max(80).optional(),
  sourceText: z.string().max(1_000_000).optional(),
  sourceChecksum: z.string().max(80).optional(),
  rows: z.array(bodyCompositionDraftRowSchema).min(1).max(200)
});

const manualLabImportSchema = z.object({
  collectedAt: z.string().min(1).max(80),
  panelName: z.string().min(1).max(160),
  labName: z.string().max(160).optional(),
  markers: z
    .array(
      z
        .object({
          markerName: z.string().max(160).optional(),
          markerCode: z.string().max(120).optional(),
          value: z.number().finite(),
          unit: z.string().max(32).optional(),
          referenceLow: z.number().finite().optional(),
          referenceHigh: z.number().finite().optional()
        })
        .refine((row) => (row.markerName?.trim()?.length ?? 0) > 0 || (row.markerCode?.trim()?.length ?? 0) > 0, {
          message: "markerName or markerCode is required"
        })
    )
    .min(1)
});

const samsungJsonUploadSchema = z.object({
  uploadPath: z.string().min(1).max(400).optional()
});

const nlQuerySchema = z.object({
  question: z.string().min(3).max(500)
});

const llmSimpleSchema = z.object({
  prompt: z.string().min(1).max(4000).default("Reply with exactly: local model ok"),
  model: z.string().min(1).max(120).optional(),
  timeoutMs: z.number().int().min(1000).max(180000).optional(),
  provider: z.enum(["ollama", "openai"]).optional()
});

const askSchema = z.object({
  question: z.string().min(3).max(500)
});

const aiQuerySchema = z.object({
  question: z.string().min(3).max(500),
  timezone: z.string().max(80).optional(),
  debug: z.boolean().optional().default(false)
});

const measurementCodeParamSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9_-]+$/, "Measurement code contains unsupported characters.");

const observationIdParamSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9._:-]+$/, "Observation id contains unsupported characters.");

function isLoopbackAddress(address: string): boolean {
  return address === "::1" || address.startsWith("127.") || address.startsWith("::ffff:127.") || address === "::ffff:7f00:1";
}

function isOwnerOnlyPath(requestPath: string): boolean {
  return (
    requestPath === "/pair/qr" ||
    requestPath === "/pairing/pending" ||
    requestPath === "/pairing/devices" ||
    /^\/pairing\/(approve|deny|revoke)\//.test(requestPath)
  );
}

function decodeCookieToken(value: string | undefined): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

export interface AppOptions {
  publicKeyHash?: string | null;
  webRoot?: string;
}

export function createApp(store: HealthStore, pairingStore: PairingStore, options: AppOptions = {}): express.Application {
  const app = express();

  app.disable("x-powered-by");
  app.use("/api/import/body-composition/preview", express.json({ limit: "20mb" }));
  app.use("/api/import/health-connect", express.json({ limit: "10mb" }));
  app.use(express.json({ limit: "1mb" }));
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

  const rateBuckets = new Map<string, { count: number; resetAt: number }>();
  function rateLimit(max: number, windowMs: number) {
    return (request: express.Request, response: express.Response, next: express.NextFunction): void => {
      const now = Date.now();
      if (rateBuckets.size > 5_000) {
        for (const [bucketKey, bucketValue] of rateBuckets) {
          if (bucketValue.resetAt <= now) rateBuckets.delete(bucketKey);
        }
      }
      const routeGroup = request.baseUrl || request.path.split("/").slice(0, 3).join("/");
      const key = `${request.ip}:${routeGroup}`;
      const current = rateBuckets.get(key);
      const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
      bucket.count++;
      rateBuckets.set(key, bucket);
      response.setHeader("rate-limit-limit", String(max));
      response.setHeader("rate-limit-remaining", String(Math.max(0, max - bucket.count)));
      if (bucket.count > max) {
        response.setHeader("retry-after", String(Math.ceil((bucket.resetAt - now) / 1000)));
        response.status(429).json({ error: "Too many requests. Try again later." });
        return;
      }
      next();
    };
  }

  function ownerTokenIsValid(request: express.Request): boolean {
    const configured = process.env.LFA_OWNER_TOKEN ?? "";
    const encodedCookieToken = request.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("lfa_owner="))
      ?.slice("lfa_owner=".length);
    const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? decodeCookieToken(encodedCookieToken);
    const configuredBuffer = Buffer.from(configured);
    const suppliedBuffer = Buffer.from(supplied);
    return configuredBuffer.length >= 24 && configuredBuffer.length === suppliedBuffer.length && timingSafeEqual(configuredBuffer, suppliedBuffer);
  }

  app.use(rateLimit(300, 60_000));
  app.use("/api/pairing", rateLimit(30, 60_000));
  app.use("/api/llm", rateLimit(10, 60_000));
  app.use("/api/query", rateLimit(30, 60_000));

  app.post("/api/auth/local", (request, response) => {
    const address = request.socket.remoteAddress ?? "";
    const loopback = isLoopbackAddress(address);
    const origin = request.headers.origin;
    const localOrigin = !origin || /^https?:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin);
    if (!loopback || !localOrigin) {
      response.status(403).json({ error: "Local desktop authentication is only available on this computer." });
      return;
    }
    const secure = process.env.NODE_ENV === "production" && Boolean(process.env.LFA_TLS_CERT);
    response.setHeader(
      "set-cookie",
      `lfa_owner=${encodeURIComponent(process.env.LFA_OWNER_TOKEN ?? "")}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${secure ? "; Secure" : ""}`
    );
    response.status(204).end();
  });

  app.post("/api/pairing/request", (request, response) => {
    const parsed = pairingRequestSchema.parse(request.body ?? {});
    const result = pairingStore.request(parsed.deviceId, parsed.deviceName, parsed.pairingCode);
    if (!result) {
      response.status(401).json({ error: "Pairing code is invalid or expired." });
      return;
    }
    response.status(201).json({ pairingId: result.record.id, status: result.record.status, pollingSecret: result.pollingSecret });
  });

  app.get("/api/pairing/status/:pairingId", (request, response) => {
    const pollingSecret = request.headers["x-pairing-secret"];
    if (typeof pollingSecret !== "string") {
      response.status(401).json({ error: "Pairing secret required." });
      return;
    }
    const result = pairingStore.getStatus(request.params.pairingId, pollingSecret);
    if (!result) {
      response.status(404).json({ error: "Pairing request not found." });
      return;
    }
    response.json({ id: result.record.id, status: result.record.status, token: result.token });
  });

  app.use("/api", (request, response, next) => {
    const companionToken = request.headers["x-companion-token"];
    if (ownerTokenIsValid(request)) {
      next();
      return;
    }
    const ownerOnly = isOwnerOnlyPath(request.path);
    if (!ownerOnly && typeof companionToken === "string" && pairingStore.validateToken(companionToken)) {
      next();
      return;
    }
    response.setHeader("www-authenticate", ["Bearer", 'realm="Local Fitness Advisor"'].join(" "));
    response.status(401).json({ error: ownerOnly ? "Owner credential required." : "Valid owner or companion credential required." });
  });

  app.get("/api/health", (_request, response) => {
    const snapshot = store.snapshot();
    const model = currentModelConfig();
    response.json({
      ok: true,
      app: "local-fitness-advisor",
      storage: store.securityMode,
      counts: computeAnalytics(snapshot).counts,
      modelRuntime: {
        provider: model.provider,
        model: model.model,
        timeoutMs: model.timeoutMs
      }
    });
  });

  app.get("/api/pair/qr", async (_request, response, next) => {
    try {
      const lanIp = getLanIp() ?? "127.0.0.1";
      const port = Number.parseInt(process.env.PORT ?? "4317", 10);
      const scheme = process.env.LFA_TLS_CERT && process.env.LFA_TLS_KEY ? "https" : "http";
      const url = `${scheme}://${lanIp}:${port}`;
      const challenge = pairingStore.createChallenge();
      const payload = JSON.stringify({
        url,
        app: "local-fitness-advisor",
        pairingCode: challenge.code,
        expiresAt: challenge.expiresAt,
        publicKeyHash: options.publicKeyHash
      });
      response.setHeader("cache-control", "no-store");
      const buffer = await QRCode.toBuffer(payload, { type: "png", width: 300, margin: 2 });
      response.setHeader("content-type", "image/png");
      response.send(buffer);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/pairing/pending", (_request, response) => {
    const pending = pairingStore.getPending().map((r) => ({
      id: r.id,
      deviceId: r.deviceId,
      deviceName: r.deviceName,
      requestedAt: r.requestedAt
    }));
    response.json(pending);
  });

  app.post("/api/pairing/approve/:pairingId", (request, response) => {
    const record = pairingStore.approve(request.params.pairingId);
    if (!record) {
      response.status(404).json({ error: "Pairing request not found or already resolved." });
      return;
    }
    response.json({ id: record.id, status: record.status });
  });

  app.post("/api/pairing/deny/:pairingId", (request, response) => {
    const record = pairingStore.deny(request.params.pairingId);
    if (!record) {
      response.status(404).json({ error: "Pairing request not found or already resolved." });
      return;
    }
    response.json({ id: record.id, status: record.status });
  });

  app.get("/api/pairing/devices", (_request, response) => {
    response.json(pairingStore.listDevices());
  });

  app.post("/api/pairing/revoke/:pairingId", (request, response) => {
    const record = pairingStore.revoke(request.params.pairingId);
    if (!record) {
      response.status(404).json({ error: "Paired device not found." });
      return;
    }
    response.json(record);
  });

  app.get("/api/store", (_request, response) => {
    response.json(store.snapshot());
  });

  app.get("/api/profile", (_request, response) => {
    response.json(store.snapshot().profile);
  });

  app.put("/api/profile", (request, response) => {
    const parsed = profileSchema.parse(request.body);
    const profile: Profile = {
      ...parsed,
      id: "self",
      updatedAt: new Date().toISOString()
    };
    response.json(store.replaceProfile(profile));
  });

  app.post("/api/import/samsung", async (request, response, next) => {
    try {
      const parsed = importSchema.parse(request.body);
      const imported = parseSamsungHealthCsv(parsed.fileName, parsed.content);
      const merged = store.mergeImport(imported);
      const warehouse = await rebuildWarehouseFromStore(merged);
      response.status(201).json({
        store: merged,
        warehouse,
        import: {
          ...imported.sourceImport,
          rawContent: undefined
        }
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/import/blood-test", (request, response) => {
    const parsed = importSchema.parse(request.body);
    const imported = parseBloodTestCsv(parsed.fileName, parsed.content);
    response.status(201).json({
      store: store.mergeImport(imported),
      import: {
        ...imported.sourceImport,
        rawContent: undefined
      }
    });
  });

  app.post("/api/import/labs/manual", (request, response) => {
    const parsed = manualLabImportSchema.parse(request.body ?? {});
    const imported = buildManualLabEntryImport(parsed);
    response.status(201).json({
      store: store.mergeImport(imported),
      import: {
        ...imported.sourceImport,
        rawContent: undefined
      }
    });
  });

  app.post("/api/import/body-composition/preview", async (request, response, next) => {
    try {
      const parsed = bodyCompositionPreviewSchema.parse(request.body ?? {});
      const buffer = Buffer.from(parsed.contentBase64, "base64");
      if (buffer.length === 0) {
        response.status(400).json({ error: "Uploaded report was empty." });
        return;
      }
      if (buffer.length > 15_000_000) {
        response.status(413).json({ error: "Uploaded report is too large for local preview." });
        return;
      }
      const extracted = await extractBodyCompositionText(buffer, parsed.mimeType);
      const draft = parseBodyCompositionText(parsed.fileName, extracted.text);
      response.json({
        ...draft,
        diagnostics: [...extracted.diagnostics, ...draft.diagnostics].slice(0, 75)
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/import/body-composition/commit", async (request, response, next) => {
    try {
      const parsed = bodyCompositionCommitSchema.parse(request.body ?? {});
      const imported = buildBodyCompositionImportFromDraft({
        ...parsed,
        rows: parsed.rows as BodyCompositionDraftRow[]
      });
      const merged = store.mergeImport(imported);
      const warehouse = await rebuildWarehouseFromStore(merged);
      response.status(201).json({
        counts: {
          sourceImports: merged.sourceImports.length,
          observations: merged.observations.length,
          timeSeriesSamples: merged.timeSeriesSamples.length,
          activitySessions: merged.activitySessions.length,
          labMarkers: merged.labMarkers.length
        },
        store: merged,
        import: {
          ...imported.sourceImport,
          rawContent: undefined
        },
        warehouse
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/import/samsung-json-upload", async (request, response, next) => {
    try {
      const parsed = samsungJsonUploadSchema.parse(request.body ?? {});
      const imported = importSamsungJsonUpload({ uploadPath: parsed.uploadPath });
      const merged = store.mergeImport(imported.parsed);
      const warehouse = await rebuildWarehouseFromStore(merged);
      response.status(201).json({
        counts: {
          sourceImports: merged.sourceImports.length,
          observations: merged.observations.length,
          timeSeriesSamples: merged.timeSeriesSamples.length,
          activitySessions: merged.activitySessions.length,
          labMarkers: merged.labMarkers.length
        },
        import: {
          ...imported.parsed.sourceImport,
          rawContent: undefined
        },
        stats: imported.stats,
        warehouse
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/import/health-connect", async (request, response, next) => {
    try {
      const parsed = healthConnectImportRequestSchema.parse(request.body ?? {});
      const imported = parseHealthConnectImport(parsed);
      const merged = store.mergeImport(imported);
      const warehouse = await rebuildWarehouseFromStore(merged);
      response.status(201).json({
        counts: {
          sourceImports: merged.sourceImports.length,
          observations: merged.observations.length,
          timeSeriesSamples: merged.timeSeriesSamples.length,
          activitySessions: merged.activitySessions.length
        },
        import: {
          ...imported.sourceImport,
          rawContent: undefined
        },
        warehouse
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/analytics", (_request, response) => {
    response.json(computeAnalytics(store.snapshot()));
  });

  app.get("/api/summary", (_request, response) => {
    response.json(summarizeStoreData(store.snapshot()));
  });

  app.get("/api/summary/:measurementCode", (request, response) => {
    const measurementCode = measurementCodeParamSchema.parse(request.params.measurementCode);
    response.json(summarizeMeasurementDetail(store.snapshot(), measurementCode));
  });

  app.delete("/api/observations/:id", async (request, response, next) => {
    try {
      const id = observationIdParamSchema.parse(request.params.id);
      const deleted = store.deleteObservation(id);
      if (!deleted) {
        response.status(404).json({ error: "Observation not found." });
        return;
      }
      const warehouse = await rebuildWarehouseFromStore(deleted.store);
      response.json(deleteObservationResponse(deleted, warehouse));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/observations/by-type/:measurementCode", async (request, response, next) => {
    try {
      const measurementCode = measurementCodeParamSchema.parse(request.params.measurementCode);
      const deleted = store.deleteObservationsByMeasurementCode(measurementCode);
      const warehouse = await rebuildWarehouseFromStore(deleted.store);
      response.json(deleteObservationsByTypeResponse(deleted, warehouse));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/warehouse/rebuild", async (_request, response, next) => {
    try {
      const result = await rebuildWarehouseFromStore(store.snapshot());
      response.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/query/nl", async (request, response, next) => {
    try {
      const parsed = nlQuerySchema.parse(request.body ?? {});
      const planned = planWarehouseQuery(parsed.question);
      if (!planned) {
        response.status(400).json({ error: "Could not interpret question." });
        return;
      }
      const rows = await runWarehouseQuery(planned.sql);
      response.json({
        question: parsed.question,
        plan: planned.answerLead,
        sql: planned.sql.trim(),
        rows,
        rowCount: rows.length
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/query/ask", async (request, response, next) => {
    try {
      const parsed = askSchema.parse(request.body ?? {});
      const plan = planDataAnswer(parsed.question);
      if (!plan) {
        response.status(400).json({
          error: "Question is not yet supported by the ask planner.",
          supportedExamples: ["What was the last heart rate recorded?"]
        });
        return;
      }

      const rows = await runWarehouseQuery(plan.sql);
      if (rows.length === 0) {
        response.json({
          question: parsed.question,
          plan: plan.answerLead,
          sql: plan.sql.trim(),
          rowCount: 0,
          rows: [],
          answer: "I could not find matching data in your warehouse yet."
        });
        return;
      }

      const prompt = [
        "You answer health-data questions using only the supplied SQL result.",
        "If the data is present, answer in one short sentence.",
        "Do not diagnose or provide treatment advice.",
        `Question: ${parsed.question}`,
        `SQL result JSON: ${JSON.stringify(rows)}`
      ].join("\n");

      const modelResult = await callConfiguredModel(prompt);
      response.json({
        question: parsed.question,
        plan: plan.answerLead,
        sql: plan.sql.trim(),
        rowCount: rows.length,
        rows,
        answer: modelResult.ok && modelResult.text ? modelResult.text : "I found the data, but model wording was unavailable.",
        model: modelResult.ok ? `${modelResult.provider}:${modelResult.model}` : "deterministic-fallback",
        modelError: modelResult.ok ? undefined : modelResult.error
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/query/ask-store", async (request, response, next) => {
    try {
      const parsed = askSchema.parse(request.body ?? {});
      const plan = planStoreAnswer(parsed.question, store.snapshot());
      if (!plan) {
        response.status(400).json({
          error: "Question is not yet supported by the store ask planner.",
          supportedExamples: [
            "What was the last heart rate recorded?",
            "What was my latest oxygen saturation?"
          ]
        });
        return;
      }

      if (plan.rows.length === 0) {
        response.json({
          question: parsed.question,
          plan: plan.answerLead,
          rowCount: 0,
          rows: [],
          answer: "I could not find matching data in your datastore yet."
        });
        return;
      }

      const prompt = [
        "Answer the question using only the supplied datastore rows.",
        "Return one concise sentence and do not add medical advice.",
        `Question: ${parsed.question}`,
        `Datastore rows JSON: ${JSON.stringify(plan.rows)}`
      ].join("\n");

      const modelResult = await callConfiguredModel(prompt);
      response.json({
        question: parsed.question,
        plan: plan.answerLead,
        rowCount: plan.rows.length,
        rows: plan.rows,
        answer: modelResult.ok && modelResult.text ? modelResult.text : "I found the data, but model wording was unavailable.",
        model: modelResult.ok ? `${modelResult.provider}:${modelResult.model}` : "deterministic-fallback",
        modelError: modelResult.ok ? undefined : modelResult.error
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/query/ai", async (request, response, next) => {
    try {
      const parsed = aiQuerySchema.parse(request.body ?? {});

      const plannerOutcome = await planAiQuery(parsed.question, {
        timezone: parsed.timezone
      });

      if (!plannerOutcome.ok) {
        response.status(400).json({
          question: parsed.question,
          answer: plannerOutcome.error,
          limitations: plannerOutcome.limitations,
          suggestedRephrase: plannerOutcome.suggestedRephrase,
          confidence: 0,
          plan: null,
          sql: null,
          rows: [],
          chart: null
        });
        return;
      }

      const compileOutcome = compileQueryDSL(plannerOutcome.dsl);
      if (!compileOutcome.ok) {
        response.status(400).json({
          question: parsed.question,
          answer: `Query could not be compiled: ${compileOutcome.error}`,
          limitations: [compileOutcome.error, ...plannerOutcome.limitations],
          confidence: plannerOutcome.confidence * 0.5,
          plan: plannerOutcome.dsl,
          sql: null,
          rows: [],
          chart: null
        });
        return;
      }

      const validation = validateCompiledSql(compileOutcome.sql);
      if (!validation.valid) {
        response.status(500).json({
          question: parsed.question,
          answer: "Generated SQL failed safety validation.",
          limitations: validation.violations,
          confidence: 0,
          plan: plannerOutcome.dsl,
          sql: parsed.debug ? compileOutcome.sql : null,
          rows: [],
          chart: null
        });
        return;
      }

      const rows = await runWarehouseQuery(compileOutcome.sql);

      if (rows.length === 0) {
        response.json({
          question: parsed.question,
          answer: "No data found for this query in your local warehouse. Import more data or adjust the time range.",
          limitations: [
            "No rows returned. The warehouse may not contain data for the requested metric and time range.",
            ...plannerOutcome.limitations
          ],
          assumptions: plannerOutcome.assumptions,
          confidence: plannerOutcome.confidence,
          plan: plannerOutcome.dsl,
          sql: compileOutcome.sql,
          resolvedTimeRange: compileOutcome.resolvedTimeRange,
          rows: [],
          chart: buildChartSeries(plannerOutcome.dsl, [])
        });
        return;
      }

      const summaryPrompt = [
        "You are a wellness analytics assistant. Answer the question using only the SQL result rows below.",
        "Provide one concise sentence. Do not diagnose or recommend treatments.",
        `Safety notice: ${safetyNotice}`,
        `Question: ${parsed.question}`,
        `Time range: ${compileOutcome.resolvedTimeRange.label}`,
        `SQL result (first 20 rows): ${JSON.stringify(rows.slice(0, 20))}`
      ].join("\n");

      const modelResult = await callConfiguredModel(summaryPrompt);

      const answer =
        modelResult.ok && modelResult.text
          ? modelResult.text
          : buildFallbackAnswer(plannerOutcome.dsl, rows, compileOutcome.resolvedTimeRange.label);

      const debugInfo = parsed.debug
        ? { plannerElapsedMs: plannerOutcome.modelElapsedMs, summaryElapsedMs: modelResult.elapsedMs }
        : undefined;

      response.json({
        question: parsed.question,
        answer,
        limitations: plannerOutcome.limitations,
        assumptions: plannerOutcome.assumptions,
        confidence: plannerOutcome.confidence,
        plan: plannerOutcome.dsl,
        sql: compileOutcome.sql,
        resolvedTimeRange: compileOutcome.resolvedTimeRange,
        rowCount: rows.length,
        rows: rows.slice(0, 100),
        chart: buildChartSeries(plannerOutcome.dsl, rows),
        model: modelResult.ok ? `${modelResult.provider}:${modelResult.model}` : "deterministic-fallback",
        modelError: modelResult.ok ? undefined : modelResult.error,
        debug: debugInfo
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/llm/simple", async (request, response, next) => {
    try {
      const parsed = llmSimpleSchema.parse(request.body ?? {});
      const result = await callConfiguredModel(parsed.prompt, {
        model: parsed.model,
        timeoutMs: parsed.timeoutMs,
        provider: parsed.provider
      });
      if (!result.ok) {
        response.status(result.error?.includes("timed out") ? 504 : 502).json(result);
        return;
      }
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/insights/generate", async (_request, response, next) => {
    try {
      const insight = await generateInsight(store.snapshot());
      response.status(201).json(store.addInsight(insight));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/export", (_request, response) => {
    response.setHeader("content-disposition", "attachment; filename=local-fitness-advisor-export.json");
    response.json(store.exportData());
  });

  if (options.webRoot && existsSync(options.webRoot)) {
    app.use(express.static(options.webRoot));
    app.get("*", rateLimit(120, 60_000), (_request, response) =>
      response.sendFile(path.join(options.webRoot!, "index.html"))
    );
  }

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError) {
      const issueSummary = error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
        .join("; ");
      response.status(400).json({ error: `Invalid request: ${issueSummary}`, issues: error.issues });
      return;
    }
    if (error instanceof Error) {
      const status = "status" in error && typeof error.status === "number" ? error.status : 500;
      response.status(status).json({
        error: status === 413 ? "Request body is too large." : error.message,
        stack: status === 500 && process.env.NODE_ENV !== "production" ? error.stack : undefined
      });
      return;
    }
    response.status(500).json({ error: "Unknown server error" });
  });

  return app;
}

function buildChartSeries(
  dsl: QueryDSL,
  rows: Array<Record<string, unknown>>
): { type: string; series: Array<{ label: string; value: number }> } | null {
  if (!dsl.chartType || dsl.chartType === "none") {
    return null;
  }
  if (dsl.intent === "timeseries") {
    const dateKey = dsl.groupBy === "week" ? "week_start" : dsl.groupBy === "month" ? "month_start" : "day";
    const series = rows
      .map((row) => ({
        label: String(row[dateKey] ?? ""),
        value: typeof row.value === "number" ? row.value : Number(row.value ?? 0)
      }))
      .filter((point) => point.label);
    return { type: dsl.chartType, series };
  }
  if (dsl.intent === "top_n") {
    const series = rows.map((row) => ({
      label: String(row.day ?? row.activity_type ?? row.week_start ?? ""),
      value: typeof row.value === "number" ? row.value : Number(row.value ?? 0)
    }));
    return { type: dsl.chartType ?? "bar", series };
  }
  if (dsl.intent === "list_activities") {
    const series = rows.map((row) => ({
      label: String(row.activity_type ?? ""),
      value: typeof row.count === "number" ? row.count : Number(row.count ?? 0)
    }));
    return { type: "bar", series };
  }
  return null;
}

function buildFallbackAnswer(
  dsl: QueryDSL,
  rows: Array<Record<string, unknown>>,
  timeLabel: string
): string {
  if (rows.length === 0) {
    return "No data available for this query.";
  }
  const first = rows[0];
  if (dsl.intent === "aggregation" && first.value !== undefined) {
    return `The ${dsl.aggregation} of ${dsl.metric ?? "metric"} for ${timeLabel} was ${first.value} ${first.unit ?? ""}.`.trim();
  }
  if (dsl.intent === "latest" && first.value !== undefined) {
    return `The latest ${dsl.metric ?? "metric"} reading was ${first.value} ${first.unit ?? ""} on ${first.day ?? ""}.`.trim();
  }
  if (dsl.intent === "top_n" && first.value !== undefined) {
    return `The highest ${dsl.metric ?? "metric"} was ${first.value} ${first.unit ?? ""} on ${first.day ?? ""} (${timeLabel}).`.trim();
  }
  if (dsl.intent === "list_activities") {
    const topActivity = rows[0];
    return `Most frequent activity for ${timeLabel}: ${topActivity.activity_type ?? "unknown"} (${topActivity.count ?? 0} sessions).`;
  }
  return `Found ${rows.length} records for ${timeLabel}.`;
}

function deleteObservationResponse(
  deleted: DeleteObservationResponse,
  warehouse: Awaited<ReturnType<typeof rebuildWarehouseFromStore>>
) {
  return {
    deletedCount: deleted.deletedCount,
    deletedObservation: deleted.deletedObservation,
    counts: storeCounts(deleted.store),
    store: deleted.store,
    warehouse
  };
}

function deleteObservationsByTypeResponse(
  deleted: DeleteObservationsByTypeResponse,
  warehouse: Awaited<ReturnType<typeof rebuildWarehouseFromStore>>
) {
  return {
    deletedCount: deleted.deletedCount,
    measurementCode: deleted.measurementCode,
    counts: storeCounts(deleted.store),
    store: deleted.store,
    warehouse
  };
}

function storeCounts(snapshot: ReturnType<HealthStore["snapshot"]>) {
  return {
    sourceImports: snapshot.sourceImports.length,
    observations: snapshot.observations.length,
    timeSeriesSamples: snapshot.timeSeriesSamples.length,
    activitySessions: snapshot.activitySessions.length,
    labMarkers: snapshot.labMarkers.length
  };
}
