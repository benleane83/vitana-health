import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const appDirectory = fileURLToPath(new URL("../apps/android-companion/", import.meta.url));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const child = spawn(npmCommand, ["run", "preview:web"], {
  cwd: appDirectory,
  env: { ...process.env, EXPO_PUBLIC_LFA_DEMO_MODE: "1" },
  stdio: "inherit"
});

child.on("error", (error) => {
  console.error(`Unable to start the mobile demo preview: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Mobile demo preview stopped by ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
