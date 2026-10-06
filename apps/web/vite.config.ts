import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const SERVER = process.env.HITSTOP_SERVER ?? "ws://localhost:3000";

export default defineConfig({
  plugins: [react()],
  // The game server runs separately; the preview server reuses this proxy by default.
  server: { proxy: { "/ws": { target: SERVER, ws: true, rewriteWsOrigin: true } } },
});
