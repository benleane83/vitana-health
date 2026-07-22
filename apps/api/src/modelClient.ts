import { getAiSettings, type AiSettings } from "./aiSettings.js";
import { assertSafeCloudModelEndpoint, type CloudModelKind } from "./modelEndpointPolicy.js";

export interface ModelRequestOptions {
  model?: string;
  timeoutMs?: number;
  provider?: "ollama" | "openai";
  allowCloud?: boolean;
  structuredOutput?: { name: string; schema: Record<string, unknown> };
  deterministic?: boolean;
  maxOutputTokens?: number;
  task?: string;
}

export interface ModelCallResult {
  ok: boolean;
  provider: "ollama" | "openai";
  endpoint: string;
  model: string;
  timeoutMs: number;
  elapsedMs: number;
  text?: string;
  status?: number;
  error?: string;
  bodySnippet?: string;
  structuredOutputMode?: "not_requested" | "enforced" | "fallback";
}

export async function callConfiguredModel(prompt: string, options?: ModelRequestOptions): Promise<ModelCallResult> {
  const settings = getAiSettings();
  const provider = options?.provider ?? settings.provider;
  const timeoutMs = options?.timeoutMs ?? parseTimeoutMs(process.env.MODEL_TIMEOUT_MS ?? process.env.OLLAMA_TIMEOUT_MS, 30000);
  if (provider === "openai" && options?.allowCloud === false) {
    return {
      ok: false,
      provider,
      endpoint: settings.endpoint,
      model: options.model ?? settings.model,
      timeoutMs,
      elapsedMs: 0,
      error: "Cloud model processing requires profile consent"
    };
  }
  if (provider === "openai") {
    return callOpenAiResponses(prompt, settings, options?.model, timeoutMs, options);
  }
  return callOllama(prompt, settings, options?.model, timeoutMs, options);
}

export function resolvedModelProvider(override?: "ollama" | "openai"): "ollama" | "openai" {
  return override ?? getAiSettings().provider;
}

export function currentModelConfig(): { provider: "ollama" | "openai"; endpoint: string; model: string; timeoutMs: number } {
  const settings = getAiSettings();
  return {
    provider: settings.provider,
    endpoint: settings.endpoint,
    model: settings.model,
    timeoutMs: settings.timeoutMs
  };
}

async function callOllama(
  prompt: string,
  settings: AiSettings,
  overrideModel: string | undefined,
  timeoutMs: number,
  options?: ModelRequestOptions
): Promise<ModelCallResult> {
  const endpoint = settings.endpoint;
  const model = overrideModel ?? settings.model;
  const result = await callJsonEndpoint({
    provider: "ollama",
    endpoint,
    model,
    timeoutMs,
    headers: { "content-type": "application/json" },
    requestBody: ollamaRequest(model, prompt, options),
    structuredOutputMode: options?.structuredOutput ? "enforced" : "not_requested",
    extractText(payload) {
      return typeof payload.response === "string" ? payload.response.trim() : "";
    }
  });
  if (options?.structuredOutput && (result.status === 400 || result.status === 422)) {
    return callJsonEndpoint({
      provider: "ollama",
      endpoint,
      model,
      timeoutMs,
      headers: { "content-type": "application/json" },
      requestBody: ollamaRequest(model, prompt, { ...options, structuredOutput: undefined }),
      structuredOutputMode: "fallback",
      extractText(payload) {
        return typeof payload.response === "string" ? payload.response.trim() : "";
      }
    });
  }
  return result;
}

async function callOpenAiResponses(
  prompt: string,
  settings: AiSettings,
  overrideModel: string | undefined,
  timeoutMs: number,
  options?: ModelRequestOptions
): Promise<ModelCallResult> {
  const endpoint = settings.endpoint;
  const apiKey = settings.apiKey ?? "";
  const model = overrideModel ?? settings.model;
  if (!endpoint) {
    return {
      ok: false,
      provider: "openai",
      endpoint,
      model,
      timeoutMs,
      elapsedMs: 0,
      error: "OPENAI_RESPONSES_ENDPOINT is not configured"
    };
  }
  if (!apiKey) {
    return {
      ok: false,
      provider: "openai",
      endpoint,
      model,
      timeoutMs,
      elapsedMs: 0,
      error: "OPENAI_API_KEY is not configured"
    };
  }

  let kind: CloudModelKind;
  try {
    kind = await assertSafeCloudModelEndpoint(endpoint);
  } catch (error) {
    return {
      ok: false,
      provider: "openai",
      endpoint,
      model,
      timeoutMs,
      elapsedMs: 0,
      error: error instanceof Error ? error.message : "Cloud model endpoint is not allowed"
    };
  }
  const headers = cloudHeaders(kind, apiKey);
  const request = cloudRequest(kind, endpoint, model, prompt, options);

  const result = await callJsonEndpoint({
    provider: "openai",
    endpoint,
    model,
    timeoutMs,
    headers,
    requestBody: request,
    structuredOutputMode: options?.structuredOutput && kind !== "anthropic"
      ? "enforced"
      : options?.structuredOutput ? "fallback" : "not_requested",
    extractText(payload) {
      if (kind === "anthropic") {
        const content = Array.isArray(payload.content) ? payload.content : [];
        return content
          .filter((part: { type?: unknown; text?: unknown }) => part?.type === "text" && typeof part.text === "string")
          .map((part: { text: string }) => part.text)
          .join("\n")
          .trim();
      }
      if (typeof payload.output_text === "string") {
        return payload.output_text.trim();
      }
      if (typeof payload.choices?.[0]?.message?.content === "string") {
        return payload.choices[0].message.content.trim();
      }
      const output = Array.isArray(payload.output) ? payload.output : [];
      const chunks: string[] = [];
      for (const item of output) {
        const content = Array.isArray(item?.content) ? item.content : [];
        for (const part of content) {
          if (typeof part?.text === "string") {
            chunks.push(part.text);
          }
        }
      }
      return chunks.join("\n").trim();
    }
  });
  if (options?.structuredOutput && kind !== "anthropic" && (result.status === 400 || result.status === 422)) {
    return callJsonEndpoint({
      provider: "openai",
      endpoint,
      model,
      timeoutMs,
      headers,
      requestBody: cloudRequest(kind, endpoint, model, prompt, { ...options, structuredOutput: undefined }),
      structuredOutputMode: "fallback",
      extractText(payload) {
        if (typeof payload.output_text === "string") return payload.output_text.trim();
        if (typeof payload.choices?.[0]?.message?.content === "string") return payload.choices[0].message.content.trim();
        return "";
      }
    });
  }
  return result;
}

async function callJsonEndpoint(args: {
  provider: "ollama" | "openai";
  endpoint: string;
  model: string;
  timeoutMs: number;
  headers: Record<string, string>;
  requestBody: string;
  extractText: (payload: any) => string;
  structuredOutputMode?: "not_requested" | "enforced" | "fallback";
}): Promise<ModelCallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(args.endpoint, {
      method: "POST",
      redirect: "manual",
      signal: controller.signal,
      headers: args.headers,
      body: args.requestBody
    });
    const elapsedMs = Date.now() - startedAt;
    const rawBody = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        provider: args.provider,
        endpoint: args.endpoint,
        model: args.model,
        timeoutMs: args.timeoutMs,
        elapsedMs,
        status: response.status,
        error: `Model endpoint returned HTTP ${response.status}`,
        bodySnippet: rawBody.slice(0, 2000),
        structuredOutputMode: args.structuredOutputMode ?? "not_requested"
      };
    }

    const payload = rawBody ? JSON.parse(rawBody) : {};
    const text = args.extractText(payload);
    if (!text) {
      return {
        ok: false,
        provider: args.provider,
        endpoint: args.endpoint,
        model: args.model,
        timeoutMs: args.timeoutMs,
        elapsedMs,
        error: "Model response did not include text output",
        bodySnippet: rawBody.slice(0, 2000),
        structuredOutputMode: args.structuredOutputMode ?? "not_requested"
      };
    }

    return {
      ok: true,
      provider: args.provider,
      endpoint: args.endpoint,
      model: args.model,
      timeoutMs: args.timeoutMs,
      elapsedMs,
      text,
      structuredOutputMode: args.structuredOutputMode ?? "not_requested"
    };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        provider: args.provider,
        endpoint: args.endpoint,
        model: args.model,
        timeoutMs: args.timeoutMs,
        elapsedMs,
        error: "Model request timed out",
        structuredOutputMode: args.structuredOutputMode ?? "not_requested"
      };
    }
    const errorMessage = error instanceof Error ? error.message : "Unknown model request failure";
    return {
      ok: false,
      provider: args.provider,
      endpoint: args.endpoint,
      model: args.model,
      timeoutMs: args.timeoutMs,
      elapsedMs,
      error: errorMessage,
      structuredOutputMode: args.structuredOutputMode ?? "not_requested"
    };
  } finally {
    clearTimeout(timer);
  }
}

function cloudHeaders(kind: CloudModelKind, apiKey: string): Record<string, string> {
  if (kind === "anthropic") {
    return {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    };
  }
  if (kind === "azure") {
    return { "content-type": "application/json", "api-key": apiKey };
  }
  return { "content-type": "application/json", authorization: `Bearer ${apiKey}` };
}

function cloudRequest(
  kind: CloudModelKind,
  endpoint: string,
  model: string,
  prompt: string,
  options?: ModelRequestOptions
): string {
  if (kind === "anthropic") {
    return JSON.stringify({
      model,
      max_tokens: options?.maxOutputTokens ?? 256,
      ...(options?.deterministic ? { temperature: 0 } : {}),
      messages: [{ role: "user", content: prompt }]
    });
  }
  const structuredOutputRouting = kind === "openrouter" && options?.structuredOutput
    ? { provider: { require_parameters: true } }
    : {};
  if (endpoint.includes("/chat/completions")) {
    return JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      ...(options?.deterministic ? { temperature: 0 } : {}),
      ...(options?.maxOutputTokens ? { max_tokens: options.maxOutputTokens } : {}),
      ...structuredOutputRouting,
      ...(options?.structuredOutput ? {
        response_format: {
          type: "json_schema",
          json_schema: {
            name: options.structuredOutput.name,
            strict: true,
            schema: options.structuredOutput.schema
          }
        }
      } : {})
    });
  }
  return JSON.stringify({
    model,
    input: prompt,
    ...(options?.maxOutputTokens ? { max_output_tokens: options.maxOutputTokens } : {}),
    ...structuredOutputRouting,
    ...(options?.structuredOutput ? {
      text: {
        format: {
          type: "json_schema",
          name: options.structuredOutput.name,
          strict: true,
          schema: options.structuredOutput.schema
        }
      }
    } : {})
  });
}

function parseTimeoutMs(rawValue: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(rawValue ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1000) {
    return fallback;
  }
  return parsed;
}

function ollamaRequest(model: string, prompt: string, options?: ModelRequestOptions): string {
  return JSON.stringify({
    model,
    prompt,
    stream: false,
    ...(options?.structuredOutput ? { format: options.structuredOutput.schema } : {}),
    ...(options?.deterministic || options?.maxOutputTokens ? {
      options: {
        ...(options.deterministic ? { temperature: 0 } : {}),
        ...(options.maxOutputTokens ? { num_predict: options.maxOutputTokens } : {})
      }
    } : {})
  });
}
