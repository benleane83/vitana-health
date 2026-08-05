import type express from "express";

export function apiRateLimitOptions(limit: number, windowMs: number) {
  return {
    limit,
    windowMs,
    standardHeaders: "draft-7" as const,
    legacyHeaders: false,
    handler: (_request: express.Request, response: express.Response): void => {
      response.status(429).json({ error: "Too many requests. Try again later.", code: "RATE_LIMITED" });
    }
  };
}