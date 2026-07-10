import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, "../../", "") };
  const apiScheme = env.LFA_TLS_CERT && env.LFA_TLS_KEY ? "https" : "http";
  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      proxy: {
        "/api": {
          target: `${apiScheme}://127.0.0.1:4317`,
          secure: false
        }
      }
    }
  };
});
