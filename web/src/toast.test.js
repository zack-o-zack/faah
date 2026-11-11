import { test, expect } from 'bun:test';
import { toastMarkup } from './toast.js';

test('toast uses Basecoat content structure and escapes caller text', () => {
  const html = toastMarkup('<done>', 'Copied "a&b"');
  expect(html).toContain('class="toast" role="status" aria-hidden="false"');
  expect(html).toContain('class="toast-content"><section><h2>&lt;done&gt;</h2><p>Copied &quot;a&amp;b&quot;</p>');
  expect(toastMarkup('', 'Ready')).toContain('<h2></h2><p>Ready</p>');
});
