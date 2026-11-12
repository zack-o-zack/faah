import { selectors as s } from '../selectors.js';
import { idle, record, waitVisible } from '../browser.js';

export async function cold({ page, url, result, prefix }) {
  await page.addInitScript(selector => {
    let pending = false;
    const observer = new MutationObserver(() => {
      if (pending) return;
      if ([...document.querySelectorAll(selector)].some(el => el.checkVisibility() && el.getBoundingClientRect().height > 0)) {
        pending = true;
        requestAnimationFrame(() => {
          performance.mark('bench:first-tree');
          observer.disconnect();
        });
      }
    });
    observer.observe(document, { subtree: true, childList: true, attributes: true });
  }, s.treeRows);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitVisible(page, s.treeRows);
  await page.waitForFunction(() => performance.getEntriesByName('bench:first-tree').length > 0);
  // performance.now() is relative to navigationStart in a fresh document.
  record(result, `${prefix}.tree`, await page.evaluate(() => performance.getEntriesByName('bench:first-tree')[0].startTime));
  record(result, `${prefix}.idle`, await idle(page));
  const data = await page.evaluate(({ all, scripts }) => {
    const scriptURLs = new Set([...document.querySelectorAll(scripts)].map(el => el.src));
    const resources = performance.getEntriesByType('resource').filter(entry =>
      scriptURLs.has(entry.name) || /\.(?:m?js)(?:\?|$)/.test(entry.name));
    return {
      jsTransferBytes: resources.reduce((n, entry) => n + entry.transferSize, 0),
      jsEncodedBytes: resources.reduce((n, entry) => n + entry.encodedBodySize, 0),
      jsDecodedBytes: resources.reduce((n, entry) => n + entry.decodedBodySize, 0),
      heapBytes: performance.memory?.usedJSHeapSize ?? null,
      elements: document.querySelectorAll(all).length,
      longTaskSupported: PerformanceObserver.supportedEntryTypes.includes('longtask'),
    };
  }, { all: s.all, scripts: s.scripts });
  // Runtime.getHeapUsage supplies an unrounded heap measurement without GC.
  const cdp = await page.context().newCDPSession(page);
  try {
    data.heapBytes = (await cdp.send('Runtime.getHeapUsage')).usedSize;
    data.domNodes = (await cdp.send('Memory.getDOMCounters')).nodes;
  } finally { await cdp.detach(); }
  record(result, `${prefix}.js_transfer`, data.jsTransferBytes, 'bytes');
  record(result, `${prefix}.heap`, data.heapBytes, 'bytes');
  record(result, `${prefix}.dom_nodes`, data.domNodes, 'nodes');
  result.details[prefix] = data;
}
