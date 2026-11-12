import { selectors as s } from '../selectors.js';
import { fixtures as f } from '../workspace.js';
import { idle, heapAndNodes, measureAction, record } from '../browser.js';
import { openFile } from './finder.js';

export async function tabs({ page, result }) {
  for (let i = 0; i < 10; i++) await openFile(page, f.tabs[i], `BENCH_TAB_${i}`);
  const times = [];
  for (let i = 0; i < 10; i++) times.push(await measureAction(page,
    () => page.locator(s.tab(f.tabs[i])).click(), s.codeContent, { text: `BENCH_TAB_${i}`, event: 'click' }));
  record(result, 'tabs.switch', times);
}

export async function memory({ page, result }) {
  // Warm one full open/close path, then compare equal empty-tab states after GC.
  await openFile(page, f.tabs[0], 'BENCH_TAB_0');
  await page.locator(s.closeTab).first().click();
  await idle(page);
  const before = await heapAndNodes(page);
  for (let i = 0; i < 20; i++) await openFile(page, f.tabs[i], `BENCH_TAB_${i}`);
  for (let i = 0; i < 20; i++) await page.locator(s.closeTab).last().click();
  await page.locator(s.tabs).waitFor({ state: 'detached' });
  await idle(page);
  const after = await heapAndNodes(page);
  record(result, 'memory.heap_delta', after.heapBytes - before.heapBytes, 'bytes');
  record(result, 'memory.dom_delta', after.domNodes - before.domNodes, 'nodes');
  record(result, 'memory.attached_delta', after.attachedElements - before.attachedElements, 'elements');
  result.details.memory = { before, after, openedAndClosed: 20,
    note: 'One cycle measures retained growth, not proof of a leak; closed-tab history may intentionally retain state.' };
}
