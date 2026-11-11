import { toastMarkup } from './toast.js';
// web/src/ui.js
import { $, esc } from './state.js';

export const vp = $('#viewport');
export const sizer = $('#sizer');
export const rowsEl = $('#rows');
export const editor = $('#editor');
export const toastEl = $('#toast');

let toastTimer = 0;
let toastLeaveTimer = 0;

export function showToast(accentText, text, duration = 2200) {
  if (!toastEl) return;
  clearTimeout(toastTimer);
  clearTimeout(toastLeaveTimer);

  toastEl.innerHTML = toastMarkup(accentText, text);
  toastEl.hidden = false;
  toastTimer = setTimeout(() => {
    toastEl.firstElementChild?.setAttribute('aria-hidden', 'true');
    toastLeaveTimer = setTimeout(() => { toastEl.hidden = true; }, 180);
  }, duration);
}

export function flashActionSuccess(el, text = 'Done', duration = 1200) {
  if (!el) return;
  const label = el.querySelector?.('.bar-action-label') || el.querySelector?.('span') || el;
  if (!label) return;
  if (el._flashTimer) clearTimeout(el._flashTimer);
  else el._oldText = label.textContent;
  label.textContent = text.startsWith('✓') ? text : '✓ ' + text;
  el.classList.add('action-success');
  el._flashTimer = setTimeout(() => {
    if (el._oldText !== undefined) label.textContent = el._oldText;
    el.classList.remove('action-success');
    delete el._flashTimer;
    delete el._oldText;
  }, duration);
}

export async function copyToClipboard(text, notify = 'Copied', triggerEl = null) {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    // Fallback for non-https/restricted contexts
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      ok = true;
    } catch (err) {
      showToast('!', 'Failed to copy to clipboard');
    }
    document.body.removeChild(ta);
  }
  if (ok) {
    if (notify) showToast('✓', notify);
    if (triggerEl) flashActionSuccess(triggerEl, 'Copied');
  }
}

export async function copyRichToClipboard(plainText, htmlText, notify = 'Copied', triggerEl = null) {
  let ok = false;
  if (htmlText && navigator.clipboard && window.ClipboardItem) {
    try {
      const textBlob = new Blob([plainText], { type: 'text/plain' });
      const htmlBlob = new Blob([htmlText], { type: 'text/html' });
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': textBlob,
          'text/html': htmlBlob,
        })
      ]);
      ok = true;
    } catch {
      ok = false;
    }
  }
  if (!ok) {
    // Fallback to copy event or plain text
    try {
      const handler = (e) => {
        e.preventDefault();
        e.clipboardData.setData('text/plain', plainText);
        if (htmlText) e.clipboardData.setData('text/html', htmlText);
      };
      document.addEventListener('copy', handler, { once: true });
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
  }
  if (!ok) {
    return copyToClipboard(plainText, notify, triggerEl);
  }
  if (notify) showToast('✓', notify);
  if (triggerEl) flashActionSuccess(triggerEl, 'Copied');
}
