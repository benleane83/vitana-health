import { isIP } from "node:net";
import { spawnSync } from "node:child_process";

const feed = validateFeed(process.env.VITANA_LAN_UPDATE_URL);
const version = process.env.VITANA_LAN_UPDATE_VERSION;
if (!version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  fail("VITANA_LAN_UPDATE_VERSION must be an increasing SemVer version.");
}
if (!process.env.CSC_LINK || !process.env.CSC_KEY_PASSWORD) {
  fail("CSC_LINK and CSC_KEY_PASSWORD are required for signed LAN packages.");
}

run("npm", ["run", "build"]);
run("npm", ["run", "prepackage", "-w", "@vitana/desktop"]);
run("npm", [
  "run", "package:signed", "-w", "@vitana/desktop", "--",
  `--config.extraMetadata.version=${version}`,
  "--config.extraMetadata.vitanaUpdateChannel=lan",
  "--config.publish.provider=generic",
  `--config.publish.url=${feed.toString()}`
]);

function validateFeed(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail("VITANA_LAN_UPDATE_URL must be a valid HTTP URL.");
  }
  if (url.protocol !== "http:" || url.username || url.password || url.search || url.hash) {
    fail("The LAN update URL must use HTTP and contain no credentials, query, or fragment.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privateIp = isPrivateIp(host);
  const acceptedHostname = process.env.VITANA_LAN_UPDATE_ALLOW_HOST?.toLowerCase() === host;
  if (!privateIp && host !== "localhost" && !acceptedHostname) {
    fail("The LAN update host must be private/loopback or match VITANA_LAN_UPDATE_ALLOW_HOST.");
  }
  return url;
}

function isPrivateIp(host) {
  if (isIP(host) === 4) {
    const [a, b] = host.split(".").map(Number);
    return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
  }
  return isIP(host) === 6 && (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb"));
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
