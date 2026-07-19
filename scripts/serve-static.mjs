import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const port = Number(process.argv[3] ?? 8082);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

if (!existsSync(root) || !statSync(root).isDirectory()) {
  console.error(`Static directory not found: ${root}`);
  process.exit(1);
}

createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  const requestedPath = resolve(root, `.${pathname}`);
  const isInsideRoot = requestedPath === root || requestedPath.startsWith(`${root}${sep}`);
  const filePath = isInsideRoot && existsSync(requestedPath) && statSync(requestedPath).isFile()
    ? requestedPath
    : resolve(root, "index.html");

  response.setHeader("Content-Type", contentTypes[extname(filePath)] ?? "application/octet-stream");
  response.setHeader("Cache-Control", "no-store");
  createReadStream(filePath).on("error", () => {
    response.statusCode = 500;
    response.end("Unable to read preview asset.");
  }).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`Static preview: http://127.0.0.1:${port}`);
});