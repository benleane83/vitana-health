import express from "express";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import {
  analyticsSummaryResponseSchema,
  appBootstrapResponseSchema,
  biologicalAgeResponseSchema,
  bodyTrendDateDetailResponseSchema,
  bodyTrendDateQuerySchema,
  bodyTrendQuerySchema,
  bodyTrendTimelineResponseSchema,
  calculateBiologicalAge,
  calendarMonthQuerySchema,
  calendarMonthResponseSchema,
  careItemListQuerySchema,
  careItemMutationResponseSchema,
  completeCareItemInputSchema,
  completeCareItemResponseSchema,
  createCareItemInputSchema,
  createHealthEventInputSchema,
  createMedicationInputSchema,
  deleteCareItemResponseSchema,
  deleteHealthEventResponseSchema,
  deleteMedicationResponseSchema,
  deleteObservationResponseSchema,
  deleteObservationsByTypeResponseSchema,
  healthDataChartSeriesResponseSchema,
  healthDataDetailResponseSchema,
  healthDataSummaryResponseSchema,
  healthEventListQuerySchema,
  healthEventMutationResponseSchema,
  hasFeature,
  insightResponseSchema,
  journalPageResponseSchema,
  journalQuerySchema,
  linkedHealthEventConflictSchema,
  measurementPinStateResponseSchema,
  observationGroupDetailResponseSchema,
  observationGroupListQuerySchema,
  paginatedCareItemsResponseSchema,
  paginatedHealthEventsResponseSchema,
  paginatedMedicationsResponseSchema,
  paginatedObservationGroupsResponseSchema,
  medicationListQuerySchema,
  medicationMutationResponseSchema,
  personalReferenceRangeInputSchema,
  PRO_FEATURE_GATING_ENABLED,
  referenceRangeStateResponseSchema,
  sleepSessionListQuerySchema,
  sleepSessionPageResponseSchema,
  updateObservationInputSchema,
  updateObservationGroupInputSchema,
  updateObservationResponseSchema
} from "@vitana/shared";
import { sendJson } from "./sendJson.js";
import { healthDataFilename, reportFilename } from "./exportFilenames.js";
import type { ProfileStoreManager } from "../storage/profileStoreManager.js";
import { describeAnalyticsStorage } from "../storage/analyticsBackend.js";
import { generateInsight } from "../insights.js";
import { buildClinicianReport } from "../clinicianReport.js";
import { createClinicianReportPdf } from "../pdfReport.js";
import { createHealthDataWorkbookStream } from "../healthDataWorkbook.js";
import type { AuthorizationPrincipal } from "../requestPrincipal.js";
import { resolvePrincipalStore } from "../requestPrincipal.js";
import {
  CareItemCompletionConflictError,
  HealthEventDeleteConflictError,
  ObservationGroupConflictError,
  ObservationGroupReadOnlyError,
  RepositoryValidationError
} from "../storage/profileRepository.js";
import type { EntitlementReader } from "../entitlementStore.js";

const measurementCodeParamSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9_-]+$/, "Measurement code contains unsupported characters.");
const calendarDateParamSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD.");

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

const updateObservationBodySchema = updateObservationInputSchema;

export function makeDataRoutes(
  storeManager: ProfileStoreManager,
  entitlementStore?: EntitlementReader,
  gatingEnabled = PRO_FEATURE_GATING_ENABLED
): express.Router {
  const router = express.Router();

  function activeStore() {
    return storeManager.getActiveStore();
  }

  function requestStore(response: express.Response) {
    return resolvePrincipalStore(storeManager, response.locals.principal as AuthorizationPrincipal);
  }

  function requireProFeature(response: express.Response, feature: "track-calendar" | "track-body-trend"): boolean {
    if (hasFeature(entitlementStore?.get().tier ?? "free", feature, gatingEnabled)) return true;
    response.status(403).json({ error: "This view requires Vitana Pro.", code: "PRO_REQUIRED" });
    return false;
  }

  router.get("/bootstrap", async (_request, response, next) => {
    try {
      sendJson(response, appBootstrapResponseSchema, await requestStore(response).appBootstrap());
    } catch (error) {
      next(error);
    }
  });

  router.get("/analytics", async (_request, response, next) => {
    try {
      sendJson(response, analyticsSummaryResponseSchema, await requestStore(response).analyticsSummary());
    } catch (error) {
      next(error);
    }
  });

  router.get("/biological-age", async (_request, response, next) => {
    try {
      sendJson(response, biologicalAgeResponseSchema, calculateBiologicalAge(await activeStore().biologicalAgeSource()));
    } catch (error) {
      next(error);
    }
  });

  router.get("/summary", async (_request, response, next) => {
    try {
      sendJson(response, healthDataSummaryResponseSchema, await requestStore(response).summary());
    } catch (error) {
      next(error);
    }
  });

  router.get("/body-trend", async (request, response, next) => {
    try {
      if (!requireProFeature(response, "track-body-trend")) return;
      const query = bodyTrendQuerySchema.parse(request.query);
      sendJson(response, bodyTrendTimelineResponseSchema, await requestStore(response).bodyTrendTimeline(query));
    } catch (error) {
      next(error);
    }
  });

  router.get("/body-trend/:date", async (request, response, next) => {
    try {
      if (!requireProFeature(response, "track-body-trend")) return;
      const date = calendarDateParamSchema.parse(request.params.date);
      const query = bodyTrendDateQuerySchema.parse(request.query);
      sendJson(response, bodyTrendDateDetailResponseSchema, await requestStore(response).bodyTrendDateDetail(date, query));
    } catch (error) {
      next(error);
    }
  });

  router.get("/calendar", async (request, response, next) => {
    try {
      if (!requireProFeature(response, "track-calendar")) return;
      const query = calendarMonthQuerySchema.parse(request.query);
      sendJson(response, calendarMonthResponseSchema, await requestStore(response).calendarMonth(query));
    } catch (error) {
      next(error);
    }
  });

  router.get("/journal", async (request, response, next) => {
    try {
      const query = journalQuerySchema.parse(request.query);
      sendJson(response, journalPageResponseSchema, await requestStore(response).journal(query));
    } catch (error) {
      next(error);
    }
  });

  router.get("/sleep-sessions", async (request, response, next) => {
    try {
      const page = sleepSessionListQuerySchema.parse(request.query);
      sendJson(response, sleepSessionPageResponseSchema, await requestStore(response).sleepSessions(page));
    } catch (error) {
      next(error);
    }
  });

  router.get("/summary/:measurementCode/chart", async (request, response, next) => {
    try {
      const measurementCode = measurementCodeParamSchema.parse(request.params.measurementCode);
      const options = chartSeriesQuerySchema.parse(request.query);
      sendJson(
        response,
        healthDataChartSeriesResponseSchema,
        await requestStore(response).measurementChartSeries(measurementCode, options)
      );
    } catch (error) {
      next(error);
    }
  });

  router.put("/summary/:measurementCode/reference-range", async (request, response, next) => {
    try {
      const measurementCode = measurementCodeParamSchema.parse(request.params.measurementCode);
      const input = personalReferenceRangeInputSchema.parse(request.body);
      sendJson(
        response,
        referenceRangeStateResponseSchema,
        await requestStore(response).upsertPersonalReferenceRange(measurementCode, input)
      );
    } catch (error) {
      next(error);
    }
  });

  router.delete("/summary/:measurementCode/reference-range", async (request, response, next) => {
    try {
      const measurementCode = measurementCodeParamSchema.parse(request.params.measurementCode);
      sendJson(
        response,
        referenceRangeStateResponseSchema,
        await requestStore(response).deletePersonalReferenceRange(measurementCode)
      );
    } catch (error) {
      next(error);
    }
  });

  router.put("/summary/:measurementCode/pin", async (request, response, next) => {
    try {
      const measurementCode = measurementCodeParamSchema.parse(request.params.measurementCode);
      sendJson(response, measurementPinStateResponseSchema, await requestStore(response).pinMeasurement(measurementCode));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/summary/:measurementCode/pin", async (request, response, next) => {
    try {
      const measurementCode = measurementCodeParamSchema.parse(request.params.measurementCode);
      sendJson(response, measurementPinStateResponseSchema, await requestStore(response).unpinMeasurement(measurementCode));
    } catch (error) {
      next(error);
    }
  });

  router.get("/summary/:measurementCode", async (request, response, next) => {
    try {
      const measurementCode = measurementCodeParamSchema.parse(request.params.measurementCode);
      const page = detailPageQuerySchema.parse(request.query);
      sendJson(
        response,
        healthDataDetailResponseSchema,
        await requestStore(response).measurementDetail(measurementCode, page)
      );
    } catch (error) {
      next(error);
    }
  });

  router.get("/care/health-events", async (request, response, next) => {
    try {
      sendJson(
        response,
        paginatedHealthEventsResponseSchema,
        await requestStore(response).listHealthEvents(healthEventListQuerySchema.parse(request.query))
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/care/health-events", async (request, response, next) => {
    try {
      sendJson(
        response.status(201),
        healthEventMutationResponseSchema,
        await requestStore(response).createHealthEvent(createHealthEventInputSchema.parse(request.body))
      );
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
      sendJson(response, healthEventMutationResponseSchema, updated);
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
      sendJson(response, deleteHealthEventResponseSchema, deleted);
    } catch (error) {
      if (error instanceof HealthEventDeleteConflictError) {
        sendJson(response.status(409), linkedHealthEventConflictSchema, {
          error: error.message,
          code: error.code,
          linkedCareItems: error.linkedCareItems
        });
        return;
      }
      next(error);
    }
  });

  router.get("/care/items", async (request, response, next) => {
    try {
      sendJson(
        response,
        paginatedCareItemsResponseSchema,
        await requestStore(response).listCareItems(careItemListQuerySchema.parse(request.query))
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/care/items", async (request, response, next) => {
    try {
      sendJson(
        response.status(201),
        careItemMutationResponseSchema,
        await requestStore(response).createCareItem(createCareItemInputSchema.parse(request.body))
      );
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
      sendJson(response, careItemMutationResponseSchema, updated);
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
      sendJson(response, completeCareItemResponseSchema, completed);
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
      sendJson(response, deleteCareItemResponseSchema, deleted);
    } catch (error) {
      next(error);
    }
  });

  router.get("/care/medications", async (request, response, next) => {
    try {
      sendJson(
        response,
        paginatedMedicationsResponseSchema,
        await requestStore(response).listMedications(medicationListQuerySchema.parse(request.query))
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/care/medications", async (request, response, next) => {
    try {
      sendJson(
        response.status(201),
        medicationMutationResponseSchema,
        await requestStore(response).createMedication(createMedicationInputSchema.parse(request.body))
      );
    } catch (error) {
      next(error);
    }
  });

  router.patch("/care/medications/:id", async (request, response, next) => {
    try {
      const id = recordIdParamSchema.parse(request.params.id);
      const updated = await requestStore(response).updateMedication(id, createMedicationInputSchema.parse(request.body));
      if (!updated) {
        response.status(404).json({ error: "Medication not found.", code: "MEDICATION_NOT_FOUND" });
        return;
      }
      sendJson(response, medicationMutationResponseSchema, updated);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/care/medications/:id", async (request, response, next) => {
    try {
      const id = recordIdParamSchema.parse(request.params.id);
      const deleted = await requestStore(response).deleteMedication(id);
      if (!deleted) {
        response.status(404).json({ error: "Medication not found.", code: "MEDICATION_NOT_FOUND" });
        return;
      }
      sendJson(response, deleteMedicationResponseSchema, deleted);
    } catch (error) {
      next(error);
    }
  });

  router.get("/observation-groups", async (request, response, next) => {
    try {
      const query = observationGroupListQuerySchema.parse(request.query);
      sendJson(
        response,
        paginatedObservationGroupsResponseSchema,
        await requestStore(response).listObservationGroups(query)
      );
    } catch (error) {
      next(error);
    }
  });

  router.get("/observation-groups/:id", async (request, response, next) => {
    try {
      const id = recordIdParamSchema.parse(request.params.id);
      const group = await requestStore(response).getObservationGroup(id);
      if (!group) {
        response.status(404).json({ error: "Observation group not found.", code: "OBSERVATION_GROUP_NOT_FOUND" });
        return;
      }
      sendJson(response, observationGroupDetailResponseSchema, group);
    } catch (error) {
      next(error);
    }
  });

  router.patch("/observation-groups/:id", async (request, response, next) => {
    try {
      const id = recordIdParamSchema.parse(request.params.id);
      const updated = await requestStore(response).updateObservationGroup(
        id,
        updateObservationGroupInputSchema.parse(request.body)
      );
      if (!updated) {
        response.status(404).json({ error: "Observation group not found.", code: "OBSERVATION_GROUP_NOT_FOUND" });
        return;
      }
      sendJson(response, observationGroupDetailResponseSchema, updated);
    } catch (error) {
      if (error instanceof ObservationGroupReadOnlyError) {
        response.status(403).json({ error: error.message, code: error.code });
        return;
      }
      if (error instanceof ObservationGroupConflictError) {
        response.status(409).json({ error: error.message, code: error.code });
        return;
      }
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
      const analyticsStorage = describeAnalyticsStorage(updated.counts);
      sendJson(response, updateObservationResponseSchema, { ...updated, analyticsStorage });
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
      const analyticsStorage = describeAnalyticsStorage(deleted.counts);
      sendJson(response, deleteObservationResponseSchema, { ...deleted, analyticsStorage });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/observations/by-type/:measurementCode", async (request, response, next) => {
    try {
      const measurementCode = measurementCodeParamSchema.parse(request.params.measurementCode);
      const store = activeStore();
      const deleted = await store.deleteObservationsByMeasurementCode(measurementCode);
      const analyticsStorage = describeAnalyticsStorage(deleted.counts);
      sendJson(response, deleteObservationsByTypeResponseSchema, { ...deleted, analyticsStorage });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/samples/steps/daily-aggregates", async (_request, response, next) => {
    try {
      const store = activeStore();
      const deleted = await store.deleteDailyAggregateStepSamples();
      const analyticsStorage = describeAnalyticsStorage(deleted.counts);
      sendJson(response, deleteObservationsByTypeResponseSchema, { ...deleted, analyticsStorage });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/samples/steps", async (_request, response, next) => {
    try {
      const store = activeStore();
      const deleted = await store.deleteStepSamples();
      const analyticsStorage = describeAnalyticsStorage(deleted.counts);
      sendJson(response, deleteObservationsByTypeResponseSchema, { ...deleted, analyticsStorage });
    } catch (error) {
      next(error);
    }
  });

  router.get("/analytics/storage", async (_request, response, next) => {
    try {
      const result = describeAnalyticsStorage(await activeStore().storageCounts());
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/insights/generate", async (_request, response, next) => {
    try {
      const store = activeStore();
      const [profile, analytics, reviewContext] = await Promise.all([
        store.getProfile(),
        store.analyticsSummary(),
        store.insightReviewContext()
      ]);
      const insight = await generateInsight({ profile, analytics, reviewContext });
      sendJson(response.status(201), insightResponseSchema, await store.addInsight(insight));
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
      const [profile, analytics, latestMeasurements, sourceImports, medications] = await Promise.all([
        store.getProfile(),
        store.analyticsSummary(),
        store.clinicianReportLatestMeasurements(),
        store.clinicianReportSourceImports(),
        store.listMedications({ limit: 100 })
      ]);
      const report = buildClinicianReport({
        profile,
        analytics,
        latestMeasurements,
        sourceImports,
        medications: medications.items
      });
      const pdf = await createClinicianReportPdf(report);
      response.setHeader("content-type", "application/pdf");
      response.setHeader("content-disposition", `attachment; filename="${reportFilename(report.patient.displayName)}"`);
      response.setHeader("content-length", String(pdf.length));
      response.send(pdf);
    } catch (error) {
      next(error);
    }
  });

  router.get("/export/xlsx", async (request, response, next) => {
    const abortController = new AbortController();
    const onAborted = () => abortController.abort();
    request.once("aborted", onAborted);
    response.once("close", () => {
      if (!response.writableFinished) abortController.abort();
    });

    try {
      const store = activeStore();
      const profile = await store.getProfile();
      const workbook = createHealthDataWorkbookStream(store, {
        signal: abortController.signal
      });

      response.setHeader(
        "content-type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      response.setHeader(
        "content-disposition",
        `attachment; filename="${healthDataFilename(profile.displayName)}"`
      );
      response.status(200);
      await pipeline(workbook, response);
      request.off("aborted", onAborted);
      await store.recordExportAudit();
    } catch (error) {
      request.off("aborted", onAborted);
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
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
