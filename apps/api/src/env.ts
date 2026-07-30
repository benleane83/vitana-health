/**
 * Typed environment validation. Call validateEnv() at startup before any
 * other server code runs. Throws with a descriptive message if required
 * configuration is missing or invalid.
 */
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4317),
  HOST: z.string().min(1).default("127.0.0.1"),

  // Auth — both are required for LAN operation but tested individually so tests
  // can omit them when they supply explicit values.
  VITANA_OWNER_TOKEN: z
    .string()
    .min(24, "VITANA_OWNER_TOKEN must be at least 24 characters for security")
    .optional(),
  VITANA_SECRET: z
    .string()
    .min(16, "VITANA_SECRET must be at least 16 characters for security")
    .optional(),

  // Minted per launch by the desktop shell and handed to the renderer, so that loopback alone does
  // not entitle a caller to the owner cookie. Absent during local development.
  VITANA_LOCAL_AUTH_NONCE: z
    .string()
    .min(16, "VITANA_LOCAL_AUTH_NONCE must be at least 16 characters for security")
    .optional(),

  // Data storage
  VITANA_DATA_DIR: z.string().optional(),
  VITANA_DUCKDB_HTTPFS_EXTENSION: z.string().optional(),

  // TLS
  VITANA_TLS_CERT: z.string().optional(),
  VITANA_TLS_KEY: z.string().optional(),

  // Web serving
  VITANA_WEB_ROOT: z.string().optional(),

  // Development overrides
  VITANA_ALLOW_INSECURE_HTTP: z.enum(["0", "1"]).default("0"),

  // Model runtime
  VITANA_OLLAMA_URL: z.string().url("VITANA_OLLAMA_URL must be a valid URL").optional(),
  VITANA_OPENAI_API_KEY: z.string().optional(),
  VITANA_MODEL_PROVIDER: z.enum(["ollama", "openai"]).optional(),
  VITANA_MODEL_NAME: z.string().optional(),
  VITANA_MODEL_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(300_000)
    .optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validates and returns a typed environment snapshot. Call once at startup.
 * Pass `process.env` (default) or an override map for testing.
 */
export function validateEnv(
  raw: Record<string, string | undefined> = process.env as Record<string, string | undefined>
): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "env"}: ${i.message}`)
      .join("; ");
    throw new Error(`Environment configuration is invalid: ${issues}`);
  }
  return result.data;
}
