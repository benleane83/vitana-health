import express from "express";
import { z } from "zod";
import {
  calculateBiologicalAge,
  careItemListQuerySchema,
  careItemMutationResponseSchema,
  completeCareItemInputSchema,
  completeCareItemResponseSchema,
  createCareItemInputSchema,
  createHealthEventInputSchema,
  deleteCareItemResponseSchema,
  deleteHealthEventResponseSchema,
  healthEventListQuerySchema,
  healthEventMutationResponseSchema,
  linkedHealthEventConflictSchema,
  measurementPinStateResponseSchema,
  paginatedCareItemsResponseSchema,
  paginatedHealthEventsResponseSchema,
  personalReferenceRangeInputSchema,
  referenceRangeStateResponseSchema,
  type DeleteObservationResponse,
  type DeleteObservationsByTypeResponse,
  type UpdateObservationResponse
} from "@vitana/shared";
import type { ProfileStoreManager } from "../storage/profileStoreManager.js";
import { describeAnalyticsStorage } from "../storage/analyticsBackend.js";
import { generateInsight } from "../insights.js";
import { buildClinicianReport } from "../clinicianReport.js";
import { createClinicianReportPdf } from "../pdfReport.js";
import type { AuthorizationPrincipal } from "../requestPrincipal.js";
import { resolvePrincipalStore } from "../requestPrincipal.js";
import { CareItemCompletionConflictError, HealthEventDeleteConflictError, RepositoryValidationError } from "../storage/profileRepository.js";

const measurementCodeParamSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9_-]+$/, "Measurement code contains unsupported characters.");

const recordIdParamSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9._:-]+$/, "Observation id contains unsupported characters.");

const detailPageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(250).default(100),
  offset: z.coerce.number().int().min(0).default(0)
});

const chartSeriesQuerySchema = z.object({
  range: z.enum(["all", "1y", "3m", "1m"]).default("all"),
  mode: z.enum(["auto", "raw"]).default("auto")
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

  function requestStore(response: express.Response) {
    return resolvePrincipalStore(storeManager, response.locals.principal as AuthorizationPrincipal);
  }

  router.get("/bootstrap", async (_request, response, next) => {
    try {
      response.json(await requestStore(response).appBootstrap());
    } catch (error) {
      next(error);
    }
  });

  router.get("/analytics", async (_request, response, next) => {
    try {
      response.json(await requestStore(response).analyticsSummary());
    } catch (error) {
      next(error);
    }
  });

  router.get("/biological-age", async (_request, response, next) => {
    try {
      response.json(calculateBiologicalAge(await activeStore().biologicalAgeSource()));
    } catch (error) {
      next(error);
    }
  });

  router.get("/summary", async (_request, response, next) => {
    try {
      response.json(await requestStore(response).summary());
    } catch (error) {
      next(error);
    }
  });

  router.get("/summary/:measurementCode/chart", async (request, response, next) => {
    try {
      const measurementCode = measurementCodeParamSchema.parse(request.params.measurementCode);
      const options = chartSeriesQuerySchema.parse(request.query);
      response.json(await requestStore(response).measurementChartSeries(measurementCode, options));
    } catch (error) {
      next(error);
    }
  });

  router.put("/summary/:measurementCode/reference-range", async (request, response, next) => {
    try {
      const measurementCode = measurementCodeParamSchema.parse(request.params.measurementCode);
      const input = personalReferenceRangeInputSchema.parse(request.body);
      response.json(referenceRangeStateResponseSchema.parse(
        await requestStore(response).upsertPersonalReferenceRange(measurementCode, input)
      ));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/summary/:measurementCode/reference-range", async (request, response, next) => {
    try {
      const measurementCode = measurementCodeParamSchema.parse(request.params.measurementCode);
      response.json(referenceRangeStateResponseSchema.parse(
        await requestStore(response).deletePersonalReferenceRange(measurementCode)
      ));
    } catch (error) {
      next(error);
    }
  });

  router.put("/summary/:measurementCode/pin", async (request, response, next) => {
    try {
      const measurementCode = measurementCodeParamSchema.parse(request.params.measurementCode);
      response.json(measurementPinStateResponseSchema.parse(
        await requestStore(response).pinMeasurement(measurementCode)
      ));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/summary/:measurementCode/pin", async (request, response, next) => {
    try {
      const measurementCode = measurementCodeParamSchema.parse(request.params.measurementCode);
      response.json(measurementPinStateResponseSchema.parse(
        await requestStore(response).unpinMeasurement(measurementCode)
      ));
    } catch (error) {
      next(error);
    }
  });

  router.get("/summary/:measurementCode", async (request, response, next) => {
    try {
      const measurementCode = measurementCodeParamSchema.parse(request.params.measurementCode);
      const page = detailPageQuerySchema.parse(request.query);
      response.json(await requestStore(response).measurementDetail(measurementCode, page));
    } catch (error) {
      next(error);
    }
  });

  router.get("/care/health-events", async (request, response, next) => {
    try {
      response.json(paginatedHealthEventsResponseSchema.parse(
        await requestStore(response).listHealthEvents(healthEventListQuerySchema.parse(request.query))
      ));
    } catch (error) {
      next(error);
    }
  });

  router.post("/care/health-events", async (request, response, next) => {
    try {
      response.status(201).json(healthEventMutationResponseSchema.parse(
        await requestStore(response).createHealthEvent(createHealthEventInputSchema.parse(request.body))
      ));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/care/health-events/:id", async (request, response, next) => {
    try {
      const id = recordIdParamSchema.parse(request.params.id);
      const updated = await requestStore(response).updateHealthEvent(id, createHealthEventInputSchema.parse(request.body));
      if (!updated) {
        response.status(404).json({ error: "Health event not found.", code: "HEALTH_EVENT_NOT_FOUND" });
        return;
      }
      response.json(healthEventMutationResponseSchema.parse(updated));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/care/health-events/:id", async (request, response, next) => {
    try {
      const id = recordIdParamSchema.parse(request.params.id);
      const deleted = await requestStore(response).deleteHealthEvent(id);
      if (!deleted) {
        response.status(404).json({ error: "Health event not found.", code: "HEALTH_EVENT_NOT_FOUND" });
        return;
      }
      response.json(deleteHealthEventResponseSchema.parse(deleted));
    } catch (error) {
      if (error instanceof HealthEventDeleteConflictError) {
        response.status(409).json(linkedHealthEventConflictSchema.parse({
          error: error.message,
          code: error.code,
          linkedCareItems: error.linkedCareItems
        }));
        return;
      }
      next(error);
    }
  });

  router.get("/care/items", async (request, response, next) => {
    try {
      response.json(paginatedCareItemsResponseSchema.parse(
        await requestStore(response).listCareItems(careItemListQuerySchema.parse(request.query))
      ));
    } catch (error) {
      next(error);
    }
  });

  router.post("/care/items", async (request, response, next) => {
    try {
      response.status(201).json(careItemMutationResponseSchema.parse(
        await requestStore(response).createCareItem(createCareItemInputSchema.parse(request.body))
      ));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/care/items/:id", async (request, response, next) => {
    try {
      const id = recordIdParamSchema.parse(request.params.id);
      const updated = await requestStore(response).updateCareItem(id, createCareItemInputSchema.parse(request.body));
      if (!updated) {
        response.status(404).json({ error: "Care item not found.", code: "CARE_ITEM_NOT_FOUND" });
        return;
      }
      response.json(careItemMutationResponseSchema.parse(updated));
    } catch (error) {
      next(error);
    }
  });

  router.post("/care/items/:id/complete", async (request, response, next) => {
    try {
      const id = recordIdParamSchema.parse(request.params.id);
      const completed = await requestStore(response).completeCareItem(id, completeCareItemInputSchema.parse(request.body));
      if (!completed) {
        response.status(404).json({ error: "Care item not found.", code: "CARE_ITEM_NOT_FOUND" });
        return;
      }
      response.json(completeCareItemResponseSchema.parse(completed));
    } catch (error) {
      if (error instanceof CareItemCompletionConflictError) {
        response.status(409).json({ error: error.message, code: error.code });
        return;
      }
      next(error);
    }
  });

  router.delete("/care/items/:id", async (request, response, next) => {
    try {
      const id = recordIdParamSchema.parse(request.params.id);
      const deleted = await requestStore(response).deleteCareItem(id);
      if (!deleted) {
        response.status(404).json({ error: "Care item not found.", code: "CARE_ITEM_NOT_FOUND" });
        return;
      }
      response.json(deleteCareItemResponseSchema.parse(deleted));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/observations/:id", async (request, response, next) => {
    try {
      const id = recordIdParamSchema.parse(request.params.id);
      const input = updateObservationBodySchema.parse(request.body);
      const store = requestStore(response);
      const updated = await store.updateObservation(id, input);
      if (!updated) {
        response.status(404).json({ error: "Observation not found.", code: "OBSERVATION_NOT_FOUND" });
        return;
      }
      const analyticsStorage = describeAnalyticsStorage(storeManager, updated.counts);
      response.json(buildUpdateObservationResponse(updated, analyticsStorage));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/observations/:id", async (request, response, next) => {
    try {
      const id = recordIdParamSchema.parse(request.params.id);
      const store = requestStore(response);
      const deleted = await store.deleteObservation(id);
      if (!deleted) {
        response.status(404).json({ error: "Observation not found.", code: "OBSERVATION_NOT_FOUND" });
        return;
      }
      const analyticsStorage = describeAnalyticsStorage(storeManager, deleted.counts);
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
      const analyticsStorage = describeAnalyticsStorage(storeManager, deleted.counts);
      response.json(buildDeleteObservationsByTypeResponse(deleted, analyticsStorage));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/samples/steps/daily-aggregates", async (_request, response, next) => {
    try {
      const store = activeStore();
      const deleted = await store.deleteDailyAggregateStepSamples();
      const analyticsStorage = describeAnalyticsStorage(storeManager, deleted.counts);
      response.json(buildDeleteObservationsByTypeResponse(deleted, analyticsStorage));
    } catch (error) {
      next(error);
    }
  });

  router.get("/analytics/storage", async (_request, response, next) => {
    try {
      const result = describeAnalyticsStorage(storeManager, await activeStore().storageCounts());
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/insights/generate", async (_request, response, next) => {
    try {
      const store = activeStore();
      const [profile, analytics] = await Promise.all([store.getProfile(), store.analyticsSummary()]);
      const insight = await generateInsight({ profile, analytics });
      response.status(201).json(await store.addInsight(insight));
    } catch (error) {
      next(error);
    }
  });

  router.get("/export", async (_request, response, next) => {
    try {
      response.setHeader("content-disposition", "attachment; filename=vitana-export.json");
      response.json(await activeStore().exportData());
    } catch (error) {
      next(error);
    }
  });

  router.get("/export/pdf", async (_request, response, next) => {
    try {
      const store = activeStore();
      const [profile, analytics, latestMeasurements, sourceImports] = await Promise.all([
        store.getProfile(),
        store.analyticsSummary(),
        store.clinicianReportLatestMeasurements(),
        store.clinicianReportSourceImports()
      ]);
      const report = buildClinicianReport({ profile, analytics, latestMeasurements, sourceImports });
      const pdf = await createClinicianReportPdf(report);
      response.setHeader("content-type", "application/pdf");
      response.setHeader("content-disposition", `attachment; filename="${reportFilename(report.patient.displayName)}"`);
      response.setHeader("content-length", String(pdf.length));
      response.send(pdf);
    } catch (error) {
      next(error);
    }
  });

  router.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    if (error instanceof z.ZodError || error instanceof RepositoryValidationError) {
      response.status(400).json({
        error: error instanceof z.ZodError ? error.issues[0]?.message ?? "Validation failed." : error.message,
        code: "VALIDATION_ERROR"
      });
      return;
    }
    next(error);
  });

  return router;
}
