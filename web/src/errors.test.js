import { test, expect } from 'bun:test';
import { errorSummary, errorAlertHtml } from './errors.js';

test('the summary keeps the error lines, once each, without their prefix', () => {
  const out = 'You are reviewing a pull request.\n\nHi\nhook: SessionStart\nERROR: You hit your usage limit.\nERROR: You hit your usage limit.';
  expect(errorSummary(out)).toBe('You hit your usage limit.');
  expect(errorSummary('fatal: not a git repository')).toBe('not a git repository');
});

test('without an error line the summary is the last line', () => {
  expect(errorSummary('building\nexit status 1\n')).toBe('exit status 1');
  expect(errorSummary('')).toBe('');
});

test('the alert offers the full output only when it says more than the summary', () => {
  expect(errorAlertHtml('Push failed')).not.toContain('copy-error');
  const html = errorAlertHtml('ERROR: limit "hit"\nmore log', { title: 'The run failed' });
  expect(html).toContain('<h2 class="col-start-2 whitespace-pre-wrap wrap-anywhere">The run failed</h2>');
  expect(html).toContain('data-error="ERROR: limit &quot;hit&quot;\nmore log"');
  expect(errorAlertHtml('Failed', { streams: [['stderr', 'trace']] })).toContain('data-error="Failed\n\nstderr:\ntrace"');
});
