import { afterEach } from 'vitest';
import { cleanup } from '@solidjs/testing-library';
Object.defineProperty(globalThis, 'document', {
  value: document,
  writable: true,
  configurable: true,
});
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorage,
  writable: true,
  configurable: true,
});
afterEach(() => {
  cleanup();
  localStorage.clear?.();
});
if (!window.matchMedia)
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  });
