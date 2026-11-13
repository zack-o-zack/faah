import { render, screen, fireEvent } from '@solidjs/testing-library';
import { expect, test } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { EditorProvider } from '../editor/context.jsx';
import { Metrics } from './Metrics.jsx';
import { fmtBytes, imageStatus, statusMessage } from './logic.js';

test('metrics chip and open popover follow workspace publications', () => {
  let app;
  render(() => {
    app = createAppStore();
    app.actions.acceptMetrics({ cpuUsage: 1.2, rssBytes: 2048, goroutines: 4 });
    return (
      <EditorProvider value={{ store: app }}>
        <Metrics />
      </EditorProvider>
    );
  });
  const button = screen.getByRole('button', { name: 'Process metrics' });
  expect(button.textContent).toContain('2.0 KB');
  fireEvent.click(button);
  expect(screen.getByRole('dialog').textContent).toContain('Goroutines 4');
  app.actions.acceptMetrics({
    cpuUsage: 4.5,
    rssBytes: 4096,
    goroutines: 8,
    lspEnabled: true,
    lspMemBytes: 1024,
  });
  expect(button.textContent).toContain('4.5%');
  expect(screen.getByRole('dialog').textContent).toContain('Goroutines 8');
  expect(button.textContent).toContain('LSP 1.0 KB');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('status formatting covers empty metrics and image dimensions and zoom', () => {
  expect(fmtBytes()).toBe('0 B');
  expect(fmtBytes(1048576)).toBe('1.0 MB');
  expect(imageStatus(null)).toBe('');
  expect(
    imageStatus({ isImage: true, imageMeta: { width: 20, height: 30 }, image: { scale: 2 } }),
  ).toBe('20 × 30 px · 200%');
});

test('workspace status exposes failures and pending work before document detail', () => {
  expect(statusMessage({ error: 'Offline', note: 'Saved', pending: true }, null)).toBe('Offline');
  expect(statusMessage({ pending: true }, null)).toBe('Refreshing workspace…');
  expect(statusMessage({ reindexing: true }, null)).toBe('Re-indexing workspace…');
  expect(statusMessage({ note: 'Agent finished' }, null)).toBe('Agent finished');
});
