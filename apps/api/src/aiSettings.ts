import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";

export type AiProvider = "ollama" | "openai";

export interface AiSettings {
  provider: AiProvider;
  endpoint: string;
  apiKey?: string;
  model: string;
  timeoutMs: number;
}

export interface PublicAiSettings extends Omit<AiSettings, "apiKey"> {
  hasApiKey: boolean;
}

export function getAiSettings(): AiSettings {
  const saved = readSavedSettings();
  return saved ?? defaultAiSettings();
}

export function saveAiSettings(settings: AiSettings): PublicAiSettings {
  const dataPath = settingsPath();
  mkdirSync(dirname(dataPath), { recursive: true, mode: 0o700 });
  const tempPath = `${dataPath}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    writeFileSync(tempPath, JSON.stringify(settings), { encoding: "utf8", mode: 0o600 });
    renameSync(tempPath, dataPath);
  } finally {
    try {
      unlinkSync(tempPath);
    } catch {
      // The atomic rename completed or the temporary file was never created.
    }
  }
  return toPublicAiSettings(settings);
}

export function toPublicAiSettings(settings: AiSettings): PublicAiSettings {
  const { apiKey, ...publicSettings } = settings;
  return { ...publicSettings, hasApiKey: Boolean(apiKey) };
}

function readSavedSettings(): AiSettings | undefined {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath(), "utf8")) as Partial<AiSettings>;
    if (
      (parsed.provider !== "ollama" && parsed.provider !== "openai") ||
      typeof parsed.endpoint !== "string" ||
      typeof parsed.model !== "string" ||
      typeof parsed.timeoutMs !== "number"
    ) {
      return undefined;
    }
    return parsed as AiSettings;
  } catch {
    return undefined;
  }
}

function defaultAiSettings(): AiSettings {
  const provider =
    (process.env.LLM_PROVIDER ?? process.env.LFA_MODEL_PROVIDER ?? "").toLowerCase() === "openai" ||
    Boolean(process.env.OPENAI_RESPONSES_ENDPOINT && process.env.OPENAI_API_KEY)
      ? "openai"
      : "ollama";
  return provider === "openai"
    ? {
        provider,
        endpoint: process.env.OPENAI_RESPONSES_ENDPOINT ?? "",
        apiKey: process.env.OPENAI_API_KEY ?? process.env.LFA_OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL ?? process.env.LFA_MODEL_NAME ?? "gpt-5.4-mini",
        timeoutMs: timeoutMs()
      }
    : {
        provider,
        endpoint: process.env.OLLAMA_ENDPOINT ?? process.env.LFA_OLLAMA_URL ?? "http://127.0.0.1:11434/api/generate",
        model: process.env.OLLAMA_MODEL ?? process.env.LFA_MODEL_NAME ?? "llama3.2",
        timeoutMs: timeoutMs()
      };
}

function timeoutMs(): number {
  const value = Number.parseInt(process.env.MODEL_TIMEOUT_MS ?? process.env.LFA_MODEL_TIMEOUT_MS ?? "30000", 10);
  return Number.isFinite(value) && value >= 1000 ? value : 30000;
}

function settingsPath(): string {
  return resolve(process.env.LFA_DATA_DIR ?? "data", "ai-settings.json");
}
