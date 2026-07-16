import express from "express";
import { z } from "zod";
import {
  buildBodyCompositionImportFromDraft,
  buildBloodTestImportFromDraft,
  buildManualLabEntryImport,
  buildManualObservationImport,
  parseBloodTestCsv,
  parseBloodTestScanText,
  parseObservationCsv,
  type BodyCompositionDraftRow
} from "@local-fitness-advisor/shared";
import type { ProfileStoreManager } from "../storage/profileStoreManager.js";
import { healthConnectImportRequestSchema, parseHealthConnectImport } from "../healthConnectImport.js";
import { describeAnalyticsStorage } from "../storage/analyticsBackend.js";
import { extractBodyCompositionText } from "../bodyCompositionExtract.js";
import { parseBodyCompositionText } from "@local-fitness-advisor/shared";
import type { AuthorizationPrincipal } from "../createApp.js";
import type { ImportMutationResult, ProfileImport } from "../storage/profileRepository.js";

function compactImportResponse(imported: ProfileImport, merged: ImportMutationResult) {
  return {
    import: { ...imported.sourceImport, rawContent: undefined },
    outcome: merged.outcome
  };
}

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
        .refine(
          (row) => (row.markerName?.trim()?.length ?? 0) > 0 || (row.markerCode?.trim()?.length ?? 0) > 0,
          { message: "markerName or markerCode is required" }
        )
    )
    .min(1)
});

const manualObservationImportSchema = z.object({
  observedAt: z.string().min(1).max(80),
  label: z.string().min(1).max(160),
  sourceName: z.string().max(160).optional(),
  observations: z.array(z.object({
    measurementName: z.string().max(160).optional(),
    measurementCode: z.string().max(120).optional(),
    value: z.number().finite(),
    unit: z.string().max(32).optional(),
    note: z.string().max(2_000).optional()
  }).refine(
    (row) => (row.measurementName?.trim()?.length ?? 0) > 0 || (row.measurementCode?.trim()?.length ?? 0) > 0,
    { message: "measurementName or measurementCode is required" }
  )).min(1)
});

export function makeImportRoutes(storeManager: ProfileStoreManager): express.Router {
  const router = express.Router();

  function activeStore() {
    return storeManager.getActiveStore();
  }

  router.post("/blood-test", async (request, response, next) => {
    try {
      const parsed = importSchema.parse(request.body);
      const imported = parseBloodTestCsv(parsed.fileName, parsed.content);
      const store = activeStore();
      const merged = await store.mergeImport(imported);
      response.status(201).json(compactImportResponse(imported, merged));
    } catch (error) {
      next(error);
    }
  });

  router.post("/observations/csv", async (request, response, next) => {
    try {
      const parsed = importSchema.parse(request.body);
      const imported = parseObservationCsv(parsed.fileName, parsed.content);
      const store = activeStore();
      const merged = await store.mergeImport(imported);
      response.status(201).json(compactImportResponse(imported, merged));
    } catch (error) {
      next(error);
    }
  });

  router.post("/observations/manual", async (request, response, next) => {
    try {
      const parsed = manualObservationImportSchema.parse(request.body ?? {});
      const imported = buildManualObservationImport(parsed);
      const store = activeStore();
      const merged = await store.mergeImport(imported);
      response.status(201).json(compactImportResponse(imported, merged));
    } catch (error) {
      next(error);
    }
  });

  router.post("/labs/manual", async (request, response, next) => {
    try {
      const parsed = manualLabImportSchema.parse(request.body ?? {});
      const imported = buildManualLabEntryImport(parsed);
      const store = activeStore();
      const merged = await store.mergeImport(imported);
      response.status(201).json(compactImportResponse(imported, merged));
    } catch (error) {
      next(error);
    }
  });

  router.post("/blood-test/preview", async (request, response, next) => {
    try {
      const parsed = bodyCompositionPreviewSchema.parse(request.body ?? {});
      const buffer = Buffer.from(parsed.contentBase64, "base64");
      if (buffer.length === 0) {
        response.status(400).json({ error: "Uploaded report was empty.", code: "EMPTY_PAYLOAD" });
        return;
      }
      if (buffer.length > 15_000_000) {
        response.status(413).json({ error: "Uploaded report is too large for local preview.", code: "PAYLOAD_TOO_LARGE" });
        return;
      }
      const extracted = await extractBodyCompositionText(buffer, parsed.mimeType);
      const draft = parseBloodTestScanText(parsed.fileName, extracted.text);
      response.json({ ...draft, diagnostics: [...extracted.diagnostics, ...draft.diagnostics].slice(0, 75) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/blood-test/commit", async (request, response, next) => {
    try {
      const parsed = bodyCompositionCommitSchema.parse(request.body ?? {});
      const imported = buildBloodTestImportFromDraft({ ...parsed, rows: parsed.rows as BodyCompositionDraftRow[] });
      const store = activeStore();
      const merged = await store.mergeImport(imported);
      const analyticsStorage = describeAnalyticsStorage(storeManager, merged.counts);
      response.status(201).json({ ...compactImportResponse(imported, merged), analyticsStorage });
    } catch (error) {
      next(error);
    }
  });

  router.post("/body-composition/preview", async (request, response, next) => {
    try {
      const parsed = bodyCompositionPreviewSchema.parse(request.body ?? {});
      const buffer = Buffer.from(parsed.contentBase64, "base64");
      if (buffer.length === 0) {
        response.status(400).json({ error: "Uploaded report was empty.", code: "EMPTY_PAYLOAD" });
        return;
      }
      if (buffer.length > 15_000_000) {
        response.status(413).json({ error: "Uploaded report is too large for local preview.", code: "PAYLOAD_TOO_LARGE" });
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

  router.post("/body-composition/commit", async (request, response, next) => {
    try {
      const parsed = bodyCompositionCommitSchema.parse(request.body ?? {});
      const imported = buildBodyCompositionImportFromDraft({
        ...parsed,
        rows: parsed.rows as BodyCompositionDraftRow[]
      });
      const store = activeStore();
      const merged = await store.mergeImport(imported);
      const analyticsStorage = describeAnalyticsStorage(storeManager, merged.counts);
      response.status(201).json({
        ...compactImportResponse(imported, merged),
        analyticsStorage
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/health-connect", async (request, response, next) => {
    try {
      const parsed = healthConnectImportRequestSchema.parse(request.body ?? {});
      const principal = response.locals.principal as AuthorizationPrincipal;
      if (principal.kind === "companion" && parsed.profileId !== principal.allowedProfileIds[0]) {
        response.status(403).json({ error: "The requested profile is not authorized for this device.", code: "PROFILE_ACCESS_DENIED" });
        return;
      }
      const targetProfileId = parsed.profileId ?? storeManager.getActiveProfileId();
      const targetStore = storeManager.getStore(targetProfileId);
      const imported = parseHealthConnectImport(parsed);
      const merged = await targetStore.mergeImport(imported);
      const analyticsStorage = describeAnalyticsStorage(storeManager, merged.counts, targetProfileId);
      response.status(201).json({
        ...compactImportResponse(imported, merged),
        analyticsStorage
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
