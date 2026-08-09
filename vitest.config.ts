import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    projects: [
      {
        resolve: {
          alias: {
            "@": path.resolve(__dirname, "src"),
            "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
          },
        },
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        resolve: {
          alias: {
            "@": path.resolve(__dirname, "src"),
            "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
          },
        },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          testTimeout: 20000,
          hookTimeout: 20000,
        },
      },
    ],
  },
});
