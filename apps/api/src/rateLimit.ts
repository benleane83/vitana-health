import type express from "express";

export function createRateLimiter() {
  const rateBuckets = new Map<string, { count: number; resetAt: number }>();

  return function rateLimit(policy: string, max: number, windowMs: number) {
    return (request: express.Request, response: express.Response, next: express.NextFunction): void => {
      const now = Date.now();
      if (rateBuckets.size > 5_000) {
        for (const [key, bucket] of rateBuckets) {
          if (bucket.resetAt <= now) rateBuckets.delete(key);
        }
      }
      const routeGroup = request.baseUrl || request.path.split("/").slice(0, 3).join("/");
      const key = `${policy}:${request.ip}:${routeGroup}`;
      const current = rateBuckets.get(key);
      const bucket =
        !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
      bucket.count++;
      rateBuckets.set(key, bucket);
      response.setHeader("rate-limit-limit", String(max));
      response.setHeader("rate-limit-remaining", String(Math.max(0, max - bucket.count)));
      if (bucket.count > max) {
        response.setHeader("retry-after", String(Math.ceil((bucket.resetAt - now) / 1000)));
        response.status(429).json({ error: "Too many requests. Try again later.", code: "RATE_LIMITED" });
        return;
      }
      next();
    };
  };
}