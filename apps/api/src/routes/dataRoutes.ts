import express from "express";
import { z } from "zod";
import {
  calculateBiologicalAge,
  computeAnalytics,
  type DeleteObservationResponse,
  type DeleteObservationsByTypeResponse
} from "@local-fitness-advisor/shared";
import type { ProfileStoreManager, HealthStore } from "../store.js";
import { refreshAnalyticsStorage } from "../storage/analyticsBackend.js";
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

function buildDeleteObservationResponse(
  deleted: DeleteObservationResponse,
  warehouse: unknown
): unknown {
  const { store: _store, ...mutation } = deleted;
  return {
    ...mutation,
    warehouse
  };
}

function buildDeleteObservationsByTypeResponse(
  deleted: DeleteObservationsByTypeResponse,
  warehouse: unknown
): unknown {
  const { store: _store, ...mutation } = deleted;
  return {
    ...mutation,
    warehouse
  };
}

function storeCounts(snapshot: ReturnType<HealthStore["snapshot"]>) {
  return {
    sourceImports: snapshot.sourceImports.length,
    observations: snapshot.observations.length,
    timeSeriesSamples: snapshot.timeSeriesSamples.length,
    activitySessions: snapshot.activitySessions.length
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

  router.get("/store", (_request, response) => {
    response.json(activeStore().snapshot());
  });

  router.get("/bootstrap", async (_request, response, next) => {
    try {
      response.json(await activeStore().appBootstrap());
    } catch (error) {
      next(error);
    }
  });

  router.get("/analytics", (_request, response) => {
    response.json(computeAnalytics(activeStore().snapshot()));
  });

  router.get("/biological-age", (_request, response) => {
    response.json(calculateBiologicalAge(activeStore().snapshot()));
  });

  router.get("/summary", async (_request, response, next) => {
    try {
      response.json(await activeStore().getSummary());
    } catch (error) {
      next(error);
    }
  });

  router.get("/summary/:measurementCode", async (request, response, next) => {
    try {
      const measurementCode = measurementCodeParamSchema.parse(request.params.measurementCode);
      const page = detailPageQuerySchema.parse(request.query);
      response.json(await activeStore().getMeasurementDetail(measurementCode, page));
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
      const warehouse = await refreshAnalyticsStorage(storeManager, deleted.store);
      response.json(buildDeleteObservationResponse(deleted, warehouse));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/observations/by-type/:measurementCode", async (request, response, next) => {
    try {
      const measurementCode = measurementCodeParamSchema.parse(request.params.measurementCode);
      const store = activeStore();
      const deleted = await store.deleteObservationsByMeasurementCode(measurementCode);
      const warehouse = await refreshAnalyticsStorage(storeManager, deleted.store);
      response.json(buildDeleteObservationsByTypeResponse(deleted, warehouse));
    } catch (error) {
      next(error);
    }
  });

  router.post("/warehouse/rebuild", async (_request, response, next) => {
    try {
      response.setHeader("x-lfa-lifecycle", "experimental");
      const result = await refreshAnalyticsStorage(storeManager, activeStore().snapshot());
      response.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/insights/generate", async (_request, response, next) => {
    try {
      const store = activeStore();
      const insight = await generateInsight(store.snapshot());
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
      const report = buildClinicianReport(activeStore().snapshot());
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
