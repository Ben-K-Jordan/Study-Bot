import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    exclude: ["e2e/**", "node_modules/**"],
    env: {
      // Run in UTC by default so results match CI on any machine. An explicit
      // TZ still wins, which is how the suite is checked in other zones.
      TZ: process.env.TZ || "UTC",
    },
  },
});
