import type express from "express";
import { z } from "zod";

/**
 * Raised when a route tries to send a payload that does not match its declared contract. This is a
 * server bug rather than a client mistake, so it carries a 500 and is deliberately *not* a
 * `ZodError` — the central error handler maps bare `ZodError`s to 400 "invalid request", which would
 * blame the caller for our own drift.
 */
export class ResponseContractError extends Error {
  readonly status = 500;

  constructor(readonly issues: z.ZodIssue[]) {
    const summary = issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    super(`Response contract violation: ${summary}`);
    this.name = "ResponseContractError";
  }
}

/**
 * Validate `payload` against the route's response schema before writing it. Every response schema is
 * `.strict()`, so this catches both missing fields and fields we forgot to add to the contract.
 */
export function sendJson<T>(
  response: express.Response,
  schema: { safeParse(value: unknown): z.SafeParseReturnType<unknown, T> },
  payload: unknown
): void {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new ResponseContractError(result.error.issues);
  }
  response.json(result.data);
}
