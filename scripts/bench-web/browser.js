import { chromium } from 'playwright-core';
import { selectors as s } from './selectors.js';

export async function launchBrowser() {
  const options = { headless: true };
  try { return { browser: await chromium.launch({ ...options, channel: 'chrome' }), channel: 'chrome' }; }
  catch (error) {
    // Do not hide a broken installed Chrome behind a silent fallback.
    if (!/not found|doesn't exist|not installed/i.test(error.message)) throw error;
    console.error('Local Chrome unavailable; trying the Playwright-managed Chromium revision.');
    try { return { browser: await chromium.launch(options), channel: 'chromium' }; }
    catch (fallback) {
      throw new Error(`No browser available. Install Google Chrome or run npx playwright-core install chromium.\n${fallback.message}`);
    }
  }
}

export async function freshPage(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
    locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'no-preference', serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(30_000);
  // Only harness-owned Performance Timeline entries; never read application globals.
  await page.addInitScript(() => {
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) performance.measure('bench:longtask', {
          start: entry.startTime, duration: entry.duration,
        });
      }).observe({ type: 'longtask', buffered: true });
    }
    if (PerformanceObserver.supportedEntryTypes.includes('event')) {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) performance.measure('bench:event', {
          start: entry.startTime, duration: entry.duration,
          detail: { name: entry.name, interactionId: entry.interactionId },
        });
      }).observe({ type: 'event', durationThreshold: 16 });
    }
  });
  return { page, context };
}

export async function waitVisible(page, selector, text) {
  try {
    await page.waitForFunction(({ selector, text }) => [...document.querySelectorAll(selector)].some(el =>
      el.checkVisibility() && el.getBoundingClientRect().height > 0 && (!text || el.textContent.includes(text))), { selector, text });
  } catch (error) { throw new Error(`Visible content timed out: selector ${selector}${text ? `, text ${JSON.stringify(text)}` : ''}`, { cause: error }); }
}

// Start at the browser's capture-phase user event, finish after the resulting DOM
// is ready for a paint. Observer setup and Playwright transport are outside timing.
export async function measureAction(page, action, selector, { text, event = 'keydown', mutation = false, mutationRoot } = {}) {
  await page.evaluate(({ selector, text, event, mutation, mutationRoot }) => {
    performance.clearMarks('bench:action-start');
    performance.clearMeasures('bench:action');
    let start, changed = false, pending = false, done = false;
    const finish = () => {
      if (done || start === undefined || (mutation && !changed)) return;
      const matches = [...document.querySelectorAll(selector)];
      if (!matches.some(el => el.checkVisibility() && el.getBoundingClientRect().height > 0 && (!text || el.textContent.includes(text)))) return;
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        done = true;
        performance.measure('bench:action', { start, end: performance.now() });
        cleanup();
      }));
    };
    const listener = () => { start = performance.now(); performance.mark('bench:action-start'); requestAnimationFrame(finish); };
    const observer = new MutationObserver(records => {
      if (start !== undefined && (!mutationRoot || records.some(record => {
        const root = document.querySelector(mutationRoot);
        return root && (root === record.target || root.contains(record.target));
      }))) changed = true;
      finish();
    });
    const cleanup = () => { clearTimeout(timer); observer.disconnect(); document.removeEventListener(event, listener, true); };
    const timer = setTimeout(cleanup, 15_000);
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
    document.addEventListener(event, listener, { capture: true, once: true });
  }, { selector, text, event, mutation, mutationRoot });
  await action();
  try {
    await page.waitForFunction(() => performance.getEntriesByName('bench:action').length > 0);
    return await page.evaluate(() => performance.getEntriesByName('bench:action')[0].duration);
  } catch (error) { throw new Error(`Action timed out: event ${event}, selector ${selector}, text ${JSON.stringify(text)}`, { cause: error }); }
}

export async function idle(page) {
  // A quiet 500ms after UI readiness, reset by any >=50ms long task.
  return page.evaluate(() => new Promise((resolve, reject) => {
    const began = performance.now();
    const check = () => {
      const now = performance.now();
      const entries = performance.getEntriesByName('bench:longtask');
      const last = entries.at(-1);
      const end = Math.max(began, last ? last.startTime + last.duration : 0);
      if (now - end >= 500) resolve(now);
      else if (now - began > 20_000) reject(new Error('App did not reach 500ms without a long task within 20s'));
      else setTimeout(check, 25);
    };
    setTimeout(check, 25);
  }));
}

export async function load(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitVisible(page, s.treeRows);
  await idle(page);
}

export function record(result, name, values, unit = 'ms') {
  result.metrics[name] = { unit, samples: Array.isArray(values) ? values : [values] };
}

export async function heapAndNodes(page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    // Instrumentation must not look like retained application memory.
    await page.evaluate(() => {
      for (const name of ['bench:action', 'bench:event', 'bench:longtask']) performance.clearMeasures(name);
      performance.clearMarks('bench:action-start');
    });
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = await cdp.send('Runtime.getHeapUsage');
    const dom = await cdp.send('Memory.getDOMCounters');
    const attached = await page.locator(s.all).count();
    return { heapBytes: heap.usedSize, domNodes: dom.nodes, attachedElements: attached, documents: dom.documents };
  } finally { await cdp.detach(); }
}

export async function eventEntries(page, since) {
  // Event Timing delivery can be deferred until the next frame / observer batch.
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 150)));
  return page.evaluate(since => performance.getEntriesByName('bench:event')
    .filter(entry => entry.startTime >= since)
    .map(entry => ({ startTime: entry.startTime, duration: entry.duration, ...entry.detail })), since);
}
