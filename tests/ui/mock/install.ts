// Runs before the app in tests/ui/harness.html: replaces the Tauri bridge with
// the in-memory backend. The test puts its data in window.__MOCK_FIXTURE__.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { createBackend, type Fixture } from "./backend";

declare global {
  interface Window {
    __MOCK_FIXTURE__?: Fixture;
    __mock: ReturnType<typeof createBackend>;
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
