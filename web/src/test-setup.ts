import { afterEach } from 'vitest';
import { cleanup } from '@solidjs/testing-library';
afterEach(() => {
  cleanup();
  localStorage.clear?.();
});
if (!window.matchMedia)
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    dispatchEvent: () => true,
    addEventListener() {},
    removeEventListener() {},
  });
// jsdom has no modal dialogs.
if (globalThis.HTMLDialogElement && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
}
