import "fake-indexeddb/auto";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach } from "vite-plus/test";
import { db } from "@webaura/db";

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string) => ({
    addEventListener: () => {},
    addListener: () => {},
    dispatchEvent: () => false,
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: () => {},
    removeListener: () => {},
  }),
});

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: MockResizeObserver,
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  db.close();
});
