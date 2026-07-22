import express from "express";
import { aiQueryRequestSchema } from "@vitana/shared";
import type { ProfileStoreManager } from "../storage/profileStoreManager.js";
import { currentModelConfig } from "../modelClient.js";
import { executeAiQuery } from "../aiQueryService.js";
import { hasCloudAiConsent } from "../privacy.js";

export function makeQueryRoutes(storeManager: ProfileStoreManager): express.Router {
  const router = express.Router();

  function activeStore() {
    return storeManager.getActiveStore();
  }

  async function ensureCloudConsent(response: express.Response, provider?: "ollama" | "openai"): Promise<boolean> {
    const resolved = provider ?? currentModelConfig().provider;
    if (resolved !== "openai") {
      return true;
    }
    if (hasCloudAiConsent(await activeStore().getProfile())) {
      return true;
    }
    response.status(403).json({
      error: "Cloud model consent is required before sending prompts off-device.",
      code: "CLOUD_CONSENT_REQUIRED",
      provider: "openai"
    });
    return false;
  }

  // AI-planned query pipeline (primary query path for the web UI)
  router.post("/ai", async (request, response, next) => {
    try {
      response.setHeader("x-vitana-lifecycle", "supported");
      if (!await ensureCloudConsent(response)) {
        return;
      }
      const parsed = aiQueryRequestSchema.parse(request.body ?? {});

      const result = await executeAiQuery(storeManager, {
        question: parsed.question,
        timezone: parsed.timezone,
        debug: parsed.debug,
        allowCloud: hasCloudAiConsent(await activeStore().getProfile())
      });
      response.status(result.ok ? 200 : result.status).json(result.body);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function makeLlmRoutes(): express.Router {
  const router = express.Router();

  router.get("/config", (_request, response) => {
    response.json(currentModelConfig());
  });

  return router;
}
