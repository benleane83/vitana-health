import { isIP } from "node:net";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const desktopPackageFile = new URL("../apps/desktop/package.json", import.meta.url);
const requireDesktopDependency = createRequire(desktopPackageFile);

export function createLanBuilderConfig(feed, version) {
  const buildConfig = JSON.parse(readFileSync(desktopPackageFile, "utf8")).build;
  return {
    ...buildConfig,
    extraMetadata: {
      ...buildConfig.extraMetadata,
      version,
      vitanaUpdateChannel: "lan"
    },
    publish: [{
      provider: "generic",
      url: feed.toString()
    }]
  };
}

export function assertDesktopUpdaterInstalled(resolveDependency = requireDesktopDependency.resolve) {
  try {
    resolveDependency("electron-updater");
  } catch {
    throw new Error("electron-updater is missing from the desktop workspace. Run npm install --workspace @vitana/desktop --include=prod before packaging.");
  }
}

function main() {
  const feed = validateFeed(process.env.VITANA_LAN_UPDATE_URL);
  const version = process.env.VITANA_LAN_UPDATE_VERSION;
  if (!version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    fail("VITANA_LAN_UPDATE_VERSION must be an increasing SemVer version.");
  }
  if (!process.env.CSC_LINK || !process.env.CSC_KEY_PASSWORD) {
    fail("CSC_LINK and CSC_KEY_PASSWORD are required for signed LAN packages.");
  }
  try {
    assertDesktopUpdaterInstalled();
  } catch (error) {
    fail(error.message);
  }

  const configDirectory = mkdtempSync(join(tmpdir(), "vitana-lan-builder-"));
  const configPath = join(configDirectory, "electron-builder.json");
  writeFileSync(configPath, `${JSON.stringify(createLanBuilderConfig(feed, version), null, 2)}\n`);

  try {
    run("npm", ["run", "build"]);
    run("npm", ["run", "prepackage", "-w", "@vitana/desktop"]);
    run("npm", [
      "run", "package:signed", "-w", "@vitana/desktop", "--",
      "--config", configPath
    ]);
  } catch (error) {
    if (error instanceof PackageCommandError) {
      process.exitCode = error.exitCode;
      return;
    }
    throw error;
  } finally {
    rmSync(configDirectory, { recursive: true, force: true });
  }
}

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
  if (result.status !== 0) throw new PackageCommandError(result.status ?? 1);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

class PackageCommandError extends Error {
  constructor(exitCode) {
    super("A desktop packaging command failed.");
    this.exitCode = exitCode;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
