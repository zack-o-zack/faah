import { selectors as s, shortcuts as key } from '../selectors.js';
import { fixtures as f } from '../workspace.js';
import { measureAction, record, waitVisible } from '../browser.js';

export async function openFile(page, name, marker, target = s.codeContent) {
  await page.keyboard.press(key.finder);
  const input = page.locator(s.finder);
  await input.fill(name);
  await page.locator(s.finderItem(name)).first().waitFor({ state: 'visible' });
  return measureAction(page, () => page.keyboard.press('Enter'), target, { text: marker });
}

export async function finder({ page, result }) {
  await page.keyboard.press(key.finder);
  await page.locator(s.finder).waitFor({ state: 'visible' });
  const latencies = [];
  for (const char of f.code) {
    latencies.push(await measureAction(page, () => page.keyboard.type(char), s.finderItems,
      { event: 'input', mutation: true, mutationRoot: s.finderResults }));
  }
  await page.locator(s.finderItem(f.code)).first().waitFor({ state: 'visible' });
  record(result, 'finder.keystroke', latencies);
  record(result, 'file.open_50k', await measureAction(page, () => page.keyboard.press('Enter'), s.codeContent, { text: 'BENCH_LINE_00001' }));
  await waitVisible(page, s.codeContent, 'BENCH_LINE_00001');
}
