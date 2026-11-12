import { selectors as s, shortcuts as key } from '../selectors.js';
import { fixtures as f } from '../workspace.js';
import { measureAction, record } from '../browser.js';
import { openFile } from './finder.js';

export async function treeSearch({ page, result }) {
  record(result, 'tree.expand_20k', await measureAction(page,
    () => page.locator(s.expandTree).click(), s.expandTree, { event: 'click', mutation: true }));
  // Expansion can still be painting other branches; wait for the busy button to reset.
  await page.locator(s.expandTree).waitFor({ state: 'visible', timeout: 30_000 });
  result.details.tree = { renderedRows: await page.locator(s.treeRows).count() };
  await page.locator(s.collapseTree).click();
  record(result, 'tree.reveal_deep', await openFile(page, 'bench-deep-target.js', undefined, s.treeFile(f.deep)));
  // The file-open timing above does not imply explorer reveal is finished.
  await page.locator(s.treeFile(f.deep)).waitFor({ state: 'visible' });
  await page.keyboard.press(key.search);
  const input = page.locator(s.search);
  await input.waitFor({ state: 'visible' });
  record(result, 'search.results', await measureAction(page,
    () => input.fill(f.search), s.searchResults, { event: 'input', text: f.search }));
}
