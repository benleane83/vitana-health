import express from "express";
import { z } from "zod";
import {
  calculateBiologicalAge,
  type DeleteObservationResponse,
  type DeleteObservationsByTypeResponse,
  type UpdateObservationResponse
} from "@local-fitness-advisor/shared";
import type { ProfileStoreManager } from "../storage/profileStoreManager.js";
import { describeAnalyticsStorage } from "../storage/analyticsBackend.js";
import { generateInsight } from "../insights.js";
import { buildClinicianReport } from "../clinicianReport.js";
import { createClinicianReportPdf } from "../pdfReport.js";

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

const detailPageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(250).default(100),
  offset: z.coerce.number().int().min(0).default(0)
});

const updateObservationBodySchema = z.object({
  measurementCode: measurementCodeParamSchema,
  observedAt: z.string().datetime({ offset: true }),
  value: z.number().finite(),
  unit: z.string().trim().min(1).max(40),
  note: z.string().trim().max(1000).optional()
}).strict();

function buildDeleteObservationResponse(
  deleted: DeleteObservationResponse,
  analyticsStorage: unknown
): unknown {
  return {
    ...deleted,
    analyticsStorage
  };
}

function buildUpdateObservationResponse(updated: UpdateObservationResponse, analyticsStorage: unknown): unknown {
  return { ...updated, analyticsStorage };
}

function buildDeleteObservationsByTypeResponse(
  deleted: DeleteObservationsByTypeResponse,
  analyticsStorage: unknown
): unknown {
  return {
    ...deleted,
    analyticsStorage
  };
}

function reportFilename(displayName: string): string {
  const safeStem = displayName
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .toLowerCase();
  return `${safeStem || "health"}-health-report.pdf`;
}

export function makeDataRoutes(storeManager: ProfileStoreManager): express.Router {
  const router = express.Router();

  function activeStore() {
    return storeManager.getActiveStore();
  }

  router.get("/store", async (_request, response, next) => {
    try {
      response.json(await activeStore().snapshot({ includeRaw: false }));
    } catch (error) {
      next(error);
    }
  });

  router.get("/bootstrap", async (_request, response, next) => {
    try {
      response.json(await activeStore().appBootstrap());
    } catch (error) {
      next(error);
    }
  });

  router.get("/analytics", async (_request, response, next) => {
    try {
      response.json(await activeStore().analyticsSummary());
    } catch (error) {
      next(error);
    }
  });

  router.get("/biological-age", async (_request, response, next) => {
    try {
      response.json(calculateBiologicalAge(await activeStore().snapshot({ includeRaw: false })));
    } catch (error) {
      next(error);
    }
  });

  router.get("/summary", async (_request, response, next) => {
    try {
      response.json(await activeStore().summary());
    } catch (error) {
      next(error);
    }
  });

  router.get("/summary/:measurementCode", async (request, response, next) => {
    try {
      const measurementCode = measurementCodeParamSchema.parse(request.params.measurementCode);
      const page = detailPageQuerySchema.parse(request.query);
      response.json(await activeStore().measurementDetail(measurementCode, page));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/observations/:id", async (request, response, next) => {
    try {
      const id = observationIdParamSchema.parse(request.params.id);
      const input = updateObservationBodySchema.parse(request.body);
      const store = activeStore();
      const updated = await store.updateObservation(id, input);
      if (!updated) {
        response.status(404).json({ error: "Observation not found.", code: "OBSERVATION_NOT_FOUND" });
        return;
      }
      const analyticsStorage = describeAnalyticsStorage(storeManager, updated);
      response.json(buildUpdateObservationResponse(updated, analyticsStorage));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/observations/:id", async (request, response, next) => {
    try {
      const id = observationIdParamSchema.parse(request.params.id);
      const store = activeStore();
      const deleted = await store.deleteObservation(id);
      if (!deleted) {
        response.status(404).json({ error: "Observation not found.", code: "OBSERVATION_NOT_FOUND" });
        return;
      }
      const analyticsStorage = describeAnalyticsStorage(storeManager, deleted);
      response.json(buildDeleteObservationResponse(deleted, analyticsStorage));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/observations/by-type/:measurementCode", async (request, response, next) => {
    try {
      const measurementCode = measurementCodeParamSchema.parse(request.params.measurementCode);
      const store = activeStore();
      const deleted = await store.deleteObservationsByMeasurementCode(measurementCode);
      const analyticsStorage = describeAnalyticsStorage(storeManager, deleted);
      response.json(buildDeleteObservationsByTypeResponse(deleted, analyticsStorage));
    } catch (error) {
      next(error);
    }
  });

  router.get("/analytics/storage", async (_request, response, next) => {
    try {
      const result = describeAnalyticsStorage(storeManager, await activeStore().snapshot({ includeRaw: false }));
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/insights/generate", async (_request, response, next) => {
    try {
      const store = activeStore();
      const insight = await generateInsight(await store.snapshot({ includeRaw: false }));
      response.status(201).json(await store.addInsight(insight));
    } catch (error) {
      next(error);
    }
  });

  router.get("/export", async (_request, response, next) => {
    try {
      response.setHeader("content-disposition", "attachment; filename=local-fitness-advisor-export.json");
      response.json(await activeStore().exportData());
    } catch (error) {
      next(error);
    }
  });

  router.get("/export/pdf", async (_request, response, next) => {
    try {
      const report = buildClinicianReport(await activeStore().snapshot({ includeRaw: false }));
      const pdf = await createClinicianReportPdf(report);
      response.setHeader("content-type", "application/pdf");
      response.setHeader("content-disposition", `attachment; filename="${reportFilename(report.patient.displayName)}"`);
      response.setHeader("content-length", String(pdf.length));
      response.send(pdf);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
