import { selectors as s } from '../selectors.js';
import { fixtures as f } from '../workspace.js';
import { record } from '../browser.js';
import { openFile } from './finder.js';

export async function previews({ page, result }) {
  record(result, 'preview.markdown_5k', await openFile(page, f.markdown, 'Benchmark document', s.markdownHeading));
  record(result, 'preview.csv_20k', await openFile(page, f.csv, 'bench-row-1', s.csv));
  result.details.previews = { csvRenderedRows: await page.locator(s.csvRows).count(),
    markdownLines: f.markdownLines, csvDataRows: f.csvRows };
}
