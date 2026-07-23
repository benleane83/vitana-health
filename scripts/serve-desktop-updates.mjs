import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { extname, resolve, sep } from "node:path";

const args = process.argv.slice(2);
if (!args.includes("--lan")) {
  console.error("Refusing LAN binding without the explicit --lan flag.");
  process.exit(1);
}
const rootArg = args[args.indexOf("--root") + 1];
const port = Number(args[args.indexOf("--port") + 1] ?? 8082);
const root = resolve(rootArg ?? "");
if (!rootArg || !existsSync(root) || !statSync(root).isDirectory() || !Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("Usage: serve-desktop-updates --lan --root <directory> [--port 8082]");
  process.exit(1);
}

const types = {
  ".yml": "application/yaml; charset=utf-8",
  ".blockmap": "application/octet-stream",
  ".exe": "application/vnd.microsoft.portable-executable"
};

createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  } catch {
    response.writeHead(400).end("Malformed request path.");
    return;
  }
  const filePath = resolve(root, `.${pathname}`);
  if (
    !(filePath === root || filePath.startsWith(`${root}${sep}`)) ||
    !existsSync(filePath) ||
    !statSync(filePath).isFile()
  ) {
    response.writeHead(404).end("Update asset not found.");
    return;
  }
  response.setHeader("Content-Type", types[extname(filePath).toLowerCase()] ?? "application/octet-stream");
  response.setHeader("Cache-Control", filePath.endsWith(`${sep}latest.yml`) ? "no-store" : "public, max-age=31536000, immutable");
  createReadStream(filePath).on("error", () => {
    if (!response.headersSent) response.writeHead(500);
    response.end("Unable to read update asset.");
  }).pipe(response);
}).listen(port, "0.0.0.0", () => {
  console.log(`Desktop updates: http://127.0.0.1:${port}`);
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) console.log(`Desktop updates: http://${address.address}:${port}`);
    }
  }
});
