import cors from "cors";

const developmentBrowserOrigins = [
  "http://127.0.0.1:5173",
  "http://localhost:5173"
] as const;

export interface BrowserOriginOptions {
  allowedBrowserOrigins?: readonly string[];
}

export function browserOriginIsAllowed(
  origin: string | undefined,
  allowedOrigins: ReadonlySet<string>
): boolean {
  return origin === undefined || allowedOrigins.has(origin);
}

export function browserOriginAllowlist(
  options: BrowserOriginOptions,
  nodeEnv = process.env.NODE_ENV
): ReadonlySet<string> {
  return new Set([
    ...(options.allowedBrowserOrigins ?? []),
    ...(nodeEnv === "development" ? developmentBrowserOrigins : [])
  ]);
}

export function browserCors(allowedOrigins: ReadonlySet<string>) {
  return cors({
    credentials: true,
    origin(origin, callback) {
      callback(null, browserOriginIsAllowed(origin, allowedOrigins));
    }
  });
}