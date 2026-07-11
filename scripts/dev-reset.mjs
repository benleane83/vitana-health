import { spawnSync } from "node:child_process";

const nodeBin = process.execPath;
const npmCli = process.env.npm_execpath;
const ports = ["4317", "5173", "5174", "5175"];

if (!npmCli) {
  console.error("Could not resolve npm executable path from npm_execpath.");
  process.exit(1);
}

const kill = spawnSync(nodeBin, [npmCli, "exec", "--", "kill-port", ...ports], {
  stdio: "inherit"
});

if (kill.error) {
  console.warn(`Port cleanup failed (${kill.error.message}); continuing to start dev servers.`);
}

const dev = spawnSync(nodeBin, [npmCli, "run", "dev"], {
  stdio: "inherit"
});

process.exit(dev.status ?? 1);
