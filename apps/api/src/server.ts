import cors from "cors";
import express from "express";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  computeAnalytics,
  parseBloodTestCsv,
  parseSamsungHealthCsv,
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
import { summarizeStoreData } from "./summary.js";

loadEnvironmentFiles();

const app = express();
const port = Number.parseInt(process.env.PORT ?? "4317", 10);
const host = process.env.HOST ?? "127.0.0.1";
const store = new HealthStore();

app.use(express.json({ limit: "25mb" }));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Only local browser origins are allowed."));
    }
  })
);

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
      endpoint: model.endpoint,
      model: model.model,
      timeoutMs: model.timeoutMs
    }
  });
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

app.post("/api/import/samsung", (request, response) => {
  const parsed = importSchema.parse(request.body);
  const imported = parseSamsungHealthCsv(parsed.fileName, parsed.content);
  response.status(201).json({
    store: store.mergeImport(imported),
    import: {
      ...imported.sourceImport,
      rawContent: undefined
    }
  });
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

app.post("/api/import/samsung-json-upload", (request, response) => {
  const parsed = samsungJsonUploadSchema.parse(request.body ?? {});
  const imported = importSamsungJsonUpload({ uploadPath: parsed.uploadPath });
  const merged = store.mergeImport(imported.parsed);
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
    stats: imported.stats
  });
});

app.post("/api/import/health-connect", (request, response) => {
  const parsed = healthConnectImportRequestSchema.parse(request.body ?? {});
  const imported = parseHealthConnectImport(parsed);
  const merged = store.mergeImport(imported);
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
    }
  });
});

app.get("/api/analytics", (_request, response) => {
  response.json(computeAnalytics(store.snapshot()));
});

app.get("/api/summary", (_request, response) => {
  response.json(summarizeStoreData(store.snapshot()));
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
    response.status(500).json({
      error: error.message,
      stack: process.env.NODE_ENV !== "production" ? error.stack : undefined
    });
    return;
  }
  response.status(500).json({ error: "Unknown server error" });
});

app.listen(port, host, () => {
  console.log(`Local Fitness Advisor API listening at http://${host}:${port}`);
});

function loadEnvironmentFiles(): void {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "..", "..", ".env.local"),
    path.resolve(process.cwd(), "..", "..", ".env")
  ];

  for (const filePath of candidates) {
    if (!existsSync(filePath)) {
      continue;
    }
    const file = readFileSync(filePath, "utf8");
    for (const rawLine of file.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      const equalsIndex = line.indexOf("=");
      if (equalsIndex <= 0) {
        continue;
      }
      const key = line.slice(0, equalsIndex).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }
      const rawValue = line.slice(equalsIndex + 1).trim();
      process.env[key] = stripOuterQuotes(rawValue);
    }
  }
}

function stripOuterQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
