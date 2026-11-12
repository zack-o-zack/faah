import { selectors as s } from '../selectors.js';
import { frameStats } from '../metrics.js';
import { record } from '../browser.js';
import { fixtures as f } from '../workspace.js';
import { openFile } from './finder.js';

export async function scroll({ page, result }) {
  await openFile(page, f.code, 'BENCH_LINE_00001');
  const data = await page.evaluate(async s => {
    const viewport = document.querySelector(s.viewport);
    const rows = () => [...document.querySelectorAll(s.codeRows)];
    const initial = rows().slice(0, 2);
    if (initial.length < 2) throw new Error(`Cannot measure line height: ${s.codeRows}`);
    const lineHeight = initial[1].getBoundingClientRect().top - initial[0].getBoundingClientRect().top;
    if (lineHeight <= 0) throw new Error('Source rows do not have a positive fixed line height');
    const originTop = initial[0].getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;
    const frames = [], checks = [], start = performance.now();
    let previous;
    function inspect() {
      const box = viewport.getBoundingClientRect();
      const visible = rows().filter(row => {
        const rect = row.getBoundingClientRect();
        return rect.bottom > box.top + 1 && rect.top < box.bottom;
      });
      const first = visible[0];
      // Read the displayed number, excluding nested line-action buttons.
      const gutter = [...(first?.querySelector(s.gutter)?.childNodes || [])]
        .filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim();
      const code = first?.querySelector(s.code)?.textContent || '';
      const expected = Math.max(1, Math.floor((viewport.scrollTop - originTop + 1) / lineHeight) + 1);
      const number = Number(gutter);
      const marker = /BENCH_LINE_(\d+)/.exec(code);
      return { scrollTop: viewport.scrollTop, expected, actual: number || null,
        geometryCorrect: Math.abs(number - expected) <= 1,
        contentCorrect: !!marker && Number(marker[1]) === number, mountedRows: rows().length };
    }
    // 240 rAF steps over 20k lines: controlled stress, independent of app internals.
    for (let i = 0; i <= 240; i++) {
      const now = await new Promise(requestAnimationFrame);
      if (previous !== undefined) frames.push(Number((now - previous).toFixed(3)));
      previous = now;
      if (i % 12 === 0 && i > 0) checks.push(inspect());
      viewport.scrollTop = Math.round(i / 240 * 20_000 * lineHeight);
    }
    // Include async chunk completion in correctness checks, outside frame timings.
    let final;
    const deadline = performance.now() + 10_000;
    do {
      await new Promise(resolve => setTimeout(resolve, 25));
      final = inspect();
    } while ((!final.geometryCorrect || !final.contentCorrect) && performance.now() < deadline);
    const end = performance.now();
    return { lineHeight, frames, checks, final, start, end,
      longTasks: performance.getEntriesByName('bench:longtask').filter(e => e.startTime >= start && e.startTime < end)
        .map(e => ({ startTime: e.startTime, duration: e.duration })) };
  }, { viewport: s.viewport, codeRows: s.codeRows, gutter: s.gutter, code: s.code });
  record(result, 'scroll.frame', data.frames);
  record(result, 'scroll.frames_over_16_7', frameStats(data.frames).dropped, 'frames');
  record(result, 'scroll.long_tasks', data.longTasks.length, 'tasks');
  record(result, 'scroll.long_task_total', data.longTasks.reduce((sum, entry) => sum + entry.duration, 0));
  record(result, 'scroll.geometry_misses', data.checks.filter(check => !check.geometryCorrect).length, 'checkpoints');
  record(result, 'scroll.content_misses', data.checks.filter(check => !check.contentCorrect).length, 'checkpoints');
  result.details.scroll = data;
  if (!data.final.geometryCorrect || !data.final.contentCorrect) {
    throw new Error(`Scroll correctness failed at selector ${s.codeRows}: ${JSON.stringify(data.final)}`);
  }
}
