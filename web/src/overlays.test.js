import { test, expect } from 'vitest';
import { prepareMenu, setMenuHidden } from './overlays.js';

test('menu visibility sets Basecoat state and arrow keys focus enabled items', () => {
  const original = globalThis.document;
  const listeners = {};
  const item = () => ({ focus() { document.activeElement = this; }, hasAttribute: () => false, setAttribute(k, v) { this[k] = v; }, classList: { remove() {} } });
  const items = [item(), item(), item()];
  const attrs = new Map();
  const panel = {
    hidden: true,
    before() {},
    hasAttribute: k => attrs.has(k),
    setAttribute: (k, v) => attrs.set(k, v),
    getAttribute: k => attrs.get(k),
    querySelectorAll: () => items,
  };
  globalThis.document = {
    activeElement: null,
    createElement: () => ({ append() {} }),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    querySelector: () => null,
  };
  try {
    prepareMenu(panel);
    expect(attrs.get('aria-hidden')).toBe('true');
    setMenuHidden(panel, false);
    expect(panel.hidden).toBe(false);
    expect(attrs.get('aria-hidden')).toBe('false');
    expect(items[0].role).toBe('menuitem');
    const key = key => listeners.keydown({ key, preventDefault() {}, stopPropagation() {} });
    key('ArrowDown');
    expect(document.activeElement).toBe(items[0]);
    key('ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    key('End');
    expect(document.activeElement).toBe(items[2]);
    key('ArrowDown');
    expect(document.activeElement).toBe(items[0]);
    setMenuHidden(panel, true);
    key('ArrowDown');
    expect(document.activeElement).toBe(items[0]);
  } finally { globalThis.document = original; }
});
