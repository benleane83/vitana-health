import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, "../../", "") };
  const apiBindHost = env.HOST ?? "127.0.0.1";
  const apiHost = env.VITANA_API_HOST ?? (apiBindHost === "0.0.0.0" || apiBindHost === "::" ? "127.0.0.1" : apiBindHost);
  const apiPort = env.VITANA_API_PORT ?? env.PORT ?? "4317";
  const explicitApiScheme = env.VITANA_API_SCHEME?.toLowerCase();
  const isLoopbackHost = apiBindHost === "127.0.0.1" || apiBindHost === "::1" || apiBindHost === "localhost";
  // API auto-generates TLS certs when bound to non-loopback hosts unless explicitly configured otherwise.
  const inferredApiScheme =
    env.VITANA_TLS_CERT && env.VITANA_TLS_KEY ? "https" : isLoopbackHost ? "http" : "https";
  const apiScheme = explicitApiScheme === "http" || explicitApiScheme === "https" ? explicitApiScheme : inferredApiScheme;

  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      proxy: {
        "/api": {
          target: `${apiScheme}://${apiHost}:${apiPort}`,
          secure: false
        }
      }
    }
  };
});
