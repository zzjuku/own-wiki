// UI smoke tests: the app's web UI in Chromium against the in-memory backend
// in tests/ui/mock (tauri-driver doesn't support macOS). Run: npm run test:ui
import { defineConfig } from "@playwright/test";

const PORT = 1430;

export default defineConfig({
  testDir: "tests/ui",
  testMatch: "**/*.spec.ts",
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    browserName: "chromium",
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1400, height: 900 },
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/tests/ui/harness.html`,
    reuseExistingServer: true,
  },
});
