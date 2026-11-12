import { selectors as s, shortcuts as key } from '../selectors.js';
import { fixtures as f } from '../workspace.js';
import { eventEntries, measureAction, record } from '../browser.js';
import { openFile } from './finder.js';
import { interactionDurations } from '../metrics.js';

export async function editor({ page, result }) {
  await openFile(page, f.code, 'BENCH_LINE_00001');
  await page.locator(s.codeContent).first().click();
  const start = await page.evaluate(() => performance.now());
  // Repeated keydown generates KeyboardEvent.repeat, like holding the key.
  for (let i = 0; i < 300; i++) await page.keyboard.down('ArrowDown');
  await page.keyboard.up('ArrowDown');
  const cursorEvents = await eventEntries(page, start);
  record(result, 'cursor.interaction', interactionDurations(cursorEvents));
  record(result, 'cursor.interactions_ge_16', interactionDurations(cursorEvents).length, 'interactions');
  result.details.cursor = { keydowns: 300, events: cursorEvents };

  // Accept only the documented large-file confirmation. Changes stay unsaved.
  const dialog = async dialog => {
    if (dialog.type() === 'confirm' && /large|unsaved changes/i.test(dialog.message())) await dialog.accept();
    else await dialog.dismiss();
  };
  page.on('dialog', dialog);
  try {
    record(result, 'edit.enter_50k', await measureAction(page, () => page.keyboard.press(key.edit), s.edit));
    await page.locator(s.edit).focus();
    await page.keyboard.press(`${key.mod}+Home`);
    const typingStart = await page.evaluate(() => performance.now());
    const latencies = [];
    for (let i = 0; i < 200; i++) latencies.push(await measureAction(page,
      () => page.keyboard.type('x'), s.edit, { event: 'input', mutation: false }));
    const typingEvents = await eventEntries(page, typingStart);
    record(result, 'edit.keystroke', latencies);
    record(result, 'edit.interaction', interactionDurations(typingEvents));
    record(result, 'edit.interactions_ge_16', interactionDurations(typingEvents).length, 'interactions');
    result.details.edit = { chars: 200, saved: false, events: typingEvents };
    await page.keyboard.press('Escape');
  } finally { page.off('dialog', dialog); }
}
