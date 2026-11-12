// web/src/reviewflow.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

// Set up minimal browser globals for headless unit tests
const elements = new Map();

function createElement(id) {
  const el = {
    id,
    hidden: false,
    classList: {
      classes: new Set(),
      add(c) { this.classes.add(c); },
      remove(c) { this.classes.delete(c); },
      contains(c) { return this.classes.has(c); }
    },
    dataset: {},
    style: {},
    innerHTML: '',
    textContent: '',
    children: [],
    focus() {},
    addEventListener() {},
    removeEventListener() {},
    appendChild(child) { this.children.push(child); },
    setAttribute(k, v) { this[k] = v; },
    getAttribute(k) { return this[k] ?? null; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  elements.set(id, el);
  return el;
}

globalThis.document = {
  body: {
    classList: {
      classes: new Set(),
      add(c) { this.classes.add(c); },
      remove(c) { this.classes.delete(c); },
      contains(c) { return this.classes.has(c); }
    }
  },
  querySelector(sel) {
    if (sel.startsWith('#')) {
      const id = sel.slice(1);
      if (!elements.has(id)) createElement(id);
      return elements.get(id);
    }
    return null;
  },
  querySelectorAll() { return []; },
  createElement(tag) {
    return createElement('elem-' + Math.random());
  },
  addEventListener() {},
  removeEventListener() {}
};

globalThis.window = globalThis;
globalThis.location = { href: 'http://localhost:7777/' };

const { getMode, setMode, getLayout, setLayout, initReviewFlow } = await import('./reviewflow.js');

test('defaults to code mode', () => {
  assert.equal(getMode(), 'code');
});

test('toggles to review mode and back to code mode', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
  setMode('review');
  assert.equal(getMode(), 'review');
  assert.equal(document.body.classList.contains('in-review-mode'), true);

  setMode('code');
  assert.equal(getMode(), 'code');
  assert.equal(document.body.classList.contains('in-review-mode'), false);
  await new Promise(resolve => setTimeout(resolve, 0));
  globalThis.fetch = originalFetch;
});

test('toggles between vertical and horizontal review layout', () => {
  setLayout('horizontal');
  assert.equal(getLayout(), 'horizontal');
  const reviewView = document.querySelector('#review-view');
  assert.equal(reviewView.classList.contains('layout-horizontal'), true);

  setLayout('vertical');
  assert.equal(getLayout(), 'vertical');
  assert.equal(reviewView.classList.contains('layout-vertical'), true);
});

test('pending stages use icon edit controls, a run button and no empty question banner', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ config: { stages: [{ title: 'Check changes', question: '', prompt: '' }] } }),
  });
  try {
    initReviewFlow();
    setMode('review');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(elements.get('review-question-banner').hidden, true);
    assert.equal(elements.get('review-stage-title').textContent, 'Check changes');
    const messages = elements.get('review-thread-msgs').innerHTML;
    assert.match(messages, /id="btn-start-single-stage" class="btn"/);
    assert.match(messages, /data-variant="special"/);
    const cards = elements.get('review-stages-container').children;
    const card = cards[cards.length - 1].innerHTML;
    assert.match(card, /aria-label="Edit this stage"><span class="icon-\[lucide--square-pen\]/);
    assert.doesNotMatch(card, /✏/);
    elements.get('btn-edit-stage-inline').onclick();
    assert.equal(elements.get('review-stage-inline-editor').hidden, false);
    elements.get('btn-cancel-stage-inline').onclick();
    assert.equal(elements.get('review-stage-inline-editor').hidden, true);
    assert.equal(elements.get('review-question-banner').hidden, true);
    elements.get('review-question-text').textContent = 'What changed?';
    elements.get('btn-cancel-stage-inline').onclick();
    assert.equal(elements.get('review-question-banner').hidden, false);
  } finally {
    setMode('code');
    globalThis.fetch = originalFetch;
  }
});

test('a configured stage shows its title and question before its first run', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ config: { stages: [{ title: 'Configured stage', question: 'What changed?' }] } }),
  });
  try {
    setMode('review');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(elements.get('review-stage-title').textContent, 'Configured stage');
    assert.equal(elements.get('review-question-text').textContent, 'What changed?');
    assert.equal(elements.get('review-question-banner').hidden, false);
  } finally {
    setMode('code');
    globalThis.fetch = originalFetch;
  }
});
