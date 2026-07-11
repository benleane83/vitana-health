import { randomBytes } from "node:crypto";
import express from "express";
import { z } from "zod";
import { getAiSettings, saveAiSettings, toPublicAiSettings, type AiSettings } from "../aiSettings.js";
import { callConfiguredModel } from "../modelClient.js";

const settingsSchema = z.object({
  provider: z.enum(["ollama", "openai"]),
  endpoint: z.string().url().max(2048),
  apiKey: z.string().max(2048).optional(),
  model: z.string().trim().min(1).max(120),
  timeoutMs: z.number().int().min(1000).max(180000).default(30000)
});

const pendingOpenRouterStates = new Map<string, number>();
const openRouterEndpoint = "https://openrouter.ai/api/v1/chat/completions";
const openRouterStateExpiryMs = 10 * 60_000;

export function makeSettingsRoutes(): express.Router {
  const router = express.Router();

  router.get("/ai", (_request, response) => {
    response.json(toPublicAiSettings(getAiSettings()));
  });

  router.put("/ai", (request, response) => {
    const parsed = settingsSchema.parse(request.body ?? {});
    const current = getAiSettings();
    const settings: AiSettings = {
      ...parsed,
      apiKey: parsed.apiKey?.trim() || current.apiKey
    };
    response.json(saveAiSettings(settings));
  });

  router.post("/ai/validate", async (_request, response) => {
    const result = await callConfiguredModel("Reply with exactly: local model ok");
    response.status(result.ok ? 200 : 400).json(result);
  });

  router.get("/ai/openrouter/connect", (request, response) => {
    const state = randomBytes(24).toString("base64url");
    pendingOpenRouterStates.set(state, Date.now() + openRouterStateExpiryMs);
    const callbackUrl = `${request.protocol}://${request.get("host")}/api/settings/ai/openrouter/callback`;
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
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: request.query.code })
      });
      const payload = (await exchange.json()) as { key?: string };
      if (!exchange.ok || !payload.key) throw new Error("OpenRouter did not return an API key.");
      saveAiSettings({
        provider: "openai",
        endpoint: openRouterEndpoint,
        apiKey: payload.key,
        model: "openai/gpt-4.1-mini",
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
