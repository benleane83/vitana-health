import { randomBytes } from "node:crypto";
import express from "express";
import {
  aiSettingsRequestSchema,
  desktopRuntimeSettingsUpdateSchema,
  type DesktopRuntimeSettingsResponse,
  type DesktopRuntimeSettingsUpdate
} from "@vitana/shared";
import { getAiSettings, saveAiSettings, toPublicAiSettings, type AiSettings } from "../aiSettings.js";
import { evaluatePlannerCase, plannerEvaluationCases } from "../aiQueryEvaluation.js";
import { planAiQuery, type PlannerFailureCategory } from "../aiQueryPlanner.js";
import { assertSafeCloudModelEndpoint, ModelEndpointPolicyError, validateModelEndpoint } from "../modelEndpointPolicy.js";

const pendingOpenRouterStates = new Map<string, number>();
const openRouterEndpoint = "https://openrouter.ai/api/v1/chat/completions";
const openRouterStateExpiryMs = 10 * 60_000;
type PlannerProbe = {
  passed: number;
  total: number;
  elapsedMs: number;
  structuredOutputMode: "not_requested" | "enforced" | "fallback";
  repairedCases: number;
  failureCategory?: PlannerFailureCategory;
  issues: string[];
};

export function makeSettingsRoutes(options: {
  assertSafeCloudEndpoint?: (endpoint: string) => Promise<unknown>;
  openRouterCallbackOrigin?: string;
  desktopRuntimeController?: {
    getSettings: () => Promise<DesktopRuntimeSettingsResponse> | DesktopRuntimeSettingsResponse;
    updateSettings: (settings: DesktopRuntimeSettingsUpdate) => Promise<DesktopRuntimeSettingsResponse> | DesktopRuntimeSettingsResponse;
  };
} = {}): express.Router {
  const router = express.Router();
  const plannerProbeCache = new Map<string, PlannerProbe>();
  const assertSafeCloudEndpoint = options.assertSafeCloudEndpoint ?? assertSafeCloudModelEndpoint;
  const openRouterCallbackOrigin = options.openRouterCallbackOrigin ?? `http://127.0.0.1:${process.env.PORT ?? "4317"}`;

  router.get("/desktop", async (_request, response, next) => {
    try {
      response.json(options.desktopRuntimeController
        ? await options.desktopRuntimeController.getSettings()
        : { supported: false, backgroundServiceEnabled: false });
    } catch (error) {
      next(error);
    }
  });

  router.put("/desktop", async (request, response, next) => {
    try {
      const settings = desktopRuntimeSettingsUpdateSchema.parse(request.body ?? {});
      if (!options.desktopRuntimeController) {
        response.status(501).json({
          error: "Desktop runtime settings are not supported by this host.",
          code: "DESKTOP_RUNTIME_UNSUPPORTED"
        });
        return;
      }
      response.json(await options.desktopRuntimeController.updateSettings(settings));
    } catch (error) {
      next(error);
    }
  });

  router.get("/ai", (_request, response) => {
    response.json(toPublicAiSettings(getAiSettings()));
  });

  router.put("/ai", async (request, response, next) => {
    try {
      const parsed = aiSettingsRequestSchema.parse(request.body ?? {});
      const endpoint = validateModelEndpoint(parsed.provider, parsed.endpoint).toString();
      if (parsed.provider === "openai") await assertSafeCloudEndpoint(endpoint);
      const current = getAiSettings();
      const submittedApiKey = parsed.apiKey?.trim();
      const originChanged = new URL(endpoint).origin !== new URL(current.endpoint).origin;
      if (parsed.provider === "openai" && originChanged && current.apiKey && !submittedApiKey) {
        throw new ModelEndpointPolicyError("Enter the API key again when changing the model endpoint origin.");
      }
      const settings: AiSettings = {
        ...parsed,
        endpoint,
        apiKey: parsed.provider === "openai" ? submittedApiKey || (!originChanged ? current.apiKey : undefined) : undefined
      };
      plannerProbeCache.clear();
      response.json(saveAiSettings(settings));
    } catch (error) {
      next(error);
    }
  });

  router.post("/ai/validate", async (_request, response) => {
    const settings = getAiSettings();
    const cacheKey = `${settings.provider}|${settings.endpoint}|${settings.model}`;
    let plannerProbe = plannerProbeCache.get(cacheKey);
    if (!plannerProbe) {
      const cases = plannerEvaluationCases.filter((testCase) => testCase.probe).slice(0, 1);
      let passed = 0;
      let repairedCases = 0;
      let elapsedMs = 0;
      let failureCategory: PlannerFailureCategory | undefined;
      const issues: string[] = [];
      const modes = new Set<"not_requested" | "enforced" | "fallback">();

      for (const testCase of cases) {
        const outcome = await planAiQuery(testCase.question, {
          timeoutMs: settings.timeoutMs,
          maxAttempts: 1
        });
        elapsedMs += outcome.modelElapsedMs;
        modes.add(outcome.structuredOutputMode);
        if (outcome.repaired) repairedCases += 1;
        if (!outcome.ok) failureCategory ??= outcome.category;
        const caseIssues = evaluatePlannerCase(testCase, outcome);
        if (caseIssues.length === 0) passed += 1;
        else {
          const detail = !outcome.ok && outcome.category === "model"
            ? outcome.limitations.find((limitation) => limitation.startsWith("Model error:")) ?? outcome.error
            : caseIssues.join(" ");
          issues.push(`${testCase.id}: ${detail}`);
        }
      }

      plannerProbe = {
        passed,
        total: cases.length,
        elapsedMs,
        structuredOutputMode: modes.has("fallback")
          ? "fallback"
          : modes.has("enforced") ? "enforced" : "not_requested",
        repairedCases,
        failureCategory,
        issues
      };
      plannerProbeCache.set(cacheKey, plannerProbe);
    }

    const modelUnavailable = plannerProbe.failureCategory === "model";
    response.json({
      ok: !modelUnavailable,
      provider: settings.provider,
      endpoint: settings.endpoint,
      model: settings.model,
      timeoutMs: settings.timeoutMs,
      elapsedMs: plannerProbe.elapsedMs,
      ...(modelUnavailable ? { error: "The configured model could not complete the compatibility probe." } : {}),
      compatibility: plannerProbe.passed === plannerProbe.total ? "compatible" : "limited",
      plannerProbe
    });
  });

  router.get("/ai/openrouter/connect", (_request, response) => {
    const state = randomBytes(24).toString("base64url");
    pendingOpenRouterStates.set(state, Date.now() + openRouterStateExpiryMs);
    const callbackUrl = new URL("/api/settings/ai/openrouter/callback", openRouterCallbackOrigin).toString();
    const authUrl = new URL("https://openrouter.ai/auth");
    authUrl.searchParams.set("callback_url", callbackUrl);
    authUrl.searchParams.set("state", state);
    response.redirect(authUrl.toString());
  });

  router.get("/ai/openrouter/callback", async (request, response) => {
    const state = typeof request.query.state === "string" ? request.query.state : "";
    const expiry = pendingOpenRouterStates.get(state);
    pendingOpenRouterStates.delete(state);
    if (!expiry || expiry < Date.now() || typeof request.query.code !== "string") {
      response.status(400).send(callbackPage(false, "OpenRouter connection could not be verified."));
      return;
    }
    try {
      const exchange = await fetch("https://openrouter.ai/api/v1/auth/keys", {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: request.query.code })
      });
      const payload = (await exchange.json()) as { key?: string };
      if (!exchange.ok || !payload.key) throw new Error("OpenRouter did not return an API key.");
      saveAiSettings({
        provider: "openai",
        endpoint: openRouterEndpoint,
        apiKey: payload.key,
        model: "openrouter/free",
        timeoutMs: 30000
      });
      response.send(callbackPage(true, "OpenRouter connected. You can close this window."));
    } catch {
      response.status(502).send(callbackPage(false, "OpenRouter connection failed. Please try again."));
    }
  });

  return router;
}

function callbackPage(ok: boolean, message: string): string {
  return `<!doctype html><title>OpenRouter connection</title><p>${message}</p><script>window.opener?.postMessage({type:"openrouter-connected",ok:${ok}},window.location.origin);window.close()</script>`;
}
