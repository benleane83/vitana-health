import type { Profile } from "@local-fitness-advisor/shared";

const blockedPromptKeys = /(name|display|note|source|file|import|profile|device|id|birth|sex|goal|json|raw|token|auth|email|phone|address)/i;
const allowedPromptKeys = /(value|unit|count|avg|min|max|sum|metric|code|status|flag|recorded|observed|start|end|date|day|week|month|activity|duration|distance|energy|heart|oxygen|glucose|cholesterol|steps|row)/i;

/**
 * Cloud prompts may include user-entered text. Redact obvious direct identifiers.
 */
export function redactFreeText(input: string): string {
  return input
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b(?:\+?\d[\d().\-\s]{7,}\d)\b/g, "[redacted-phone]")
    .replace(/\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g, "[redacted-id]")
    .replace(/\b\d{8,}\b/g, "[redacted-number]")
    .trim();
}

export function sanitizeQuestionForModel(question: string): string {
  return redactFreeText(question).slice(0, 500);
}

/**
 * Keep only bounded, structured evidence fields in cloud prompts.
 */
export function sanitizeRowsForPrompt(rows: Array<Record<string, unknown>>, maxRows = 20): Array<Record<string, unknown>> {
  const safeRows: Array<Record<string, unknown>> = [];
  for (const row of rows.slice(0, maxRows)) {
    const safe = sanitizeObject(row);
    if (Object.keys(safe).length > 0) {
      safeRows.push(safe);
    }
  }
  return safeRows;
}

export function hasCloudAiConsent(profile: Profile | undefined): boolean {
  const consent = profile?.cloudAiConsent;
  return !!(
    consent?.enabled &&
    consent.providerScopeAccepted === true &&
    typeof consent.consentedAt === "string" &&
    consent.consentedAt.length > 0
  );
}

function sanitizeObject(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (blockedPromptKeys.test(key)) {
      continue;
    }
    if (!allowedPromptKeys.test(key)) {
      continue;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (typeof value === "string") {
      const scrubbed = redactFreeText(value);
      if (key.toLowerCase().includes("date") || key.toLowerCase().includes("time") || key.toLowerCase().endsWith("_at")) {
        out[key] = scrubbed.slice(0, 10);
      } else {
        out[key] = scrubbed.slice(0, 64);
      }
      continue;
    }
  }
  return out;
}
