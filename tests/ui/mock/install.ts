// Runs before the app in tests/ui/harness.html: replaces the Tauri bridge with
// the in-memory backend. The test puts its data in window.__MOCK_FIXTURE__.
import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { createBackend, type Fixture } from "./backend";

declare global {
  interface Window {
    __MOCK_FIXTURE__?: Fixture;
    __mock: ReturnType<typeof createBackend>;
    /** A change from outside the app, reported as the file watcher would (M10). */
    __outside: (project: string, id: string, change: Record<string, unknown> | null, moveTo?: string) => Promise<void>;
    /** Sends a "files-changed" event as the file watcher would. */
    __emitChange: (change: Record<string, unknown>) => Promise<void>;
  }
}

const backend = createBackend(window.__MOCK_FIXTURE__ ?? {});
window.__mock = backend;
mockWindows("main");
mockIPC((cmd, args) => backend.handle(cmd, args), { shouldMockEvents: true });
// mockIPC drops the request headers; commands that take raw bytes need them.
const internals = (window as any).__TAURI_INTERNALS__;
const mockedInvoke = internals.invoke;
internals.invoke = (cmd: string, args: unknown, options?: { headers?: Record<string, string> }) =>
  options?.headers ? Promise.resolve().then(() => backend.handle(cmd, args, options)) : mockedInvoke(cmd, args, options);
// Images load from /mock-assets/, which the tests answer with a placeholder picture.
(window as any).__TAURI_INTERNALS__.convertFileSrc = (path: string) => `/mock-assets/${encodeURIComponent(path)}`;
window.__outside = (project, id, change, moveTo) => emit("files-changed", backend.outside(project, id, change, moveTo));
window.__emitChange = (change) =>
  emit("files-changed", {
    pages: [], removed: [], groups: false, categories: false, projectFile: false, projectThemes: false, appThemes: false, assets: false,
    ...change,
  });
