import { toastConfig } from './toast.js';
// web/src/ui.js
import { $, esc } from './state.js';

export const vp = $('#viewport');
export const sizer = $('#sizer');
export const rowsEl = $('#rows');
export const editor = $('#editor');
export const toastEl = $('#toaster');

export function showToast(kind, text, duration) {
  if (!toastEl) return;
  // Basecoat sets the toaster up on DOMContentLoaded; a toast raised during startup comes first.
  if (!toastEl.toast) window.basecoat?.init('toaster');
  toastEl.toast?.(toastConfig(kind, text, duration));
}

/** Every error alert's copy button (errors.js) puts the whole output on the clipboard and in the console. */
export function initErrorCopy() {
  document.addEventListener('click', e => {
    const btn = /** @type {HTMLElement|null} */ (e.target)?.closest?.('[data-control~=copy-error]');
    if (!btn) return;
    console.error(btn.dataset.error);
    copyToClipboard(btn.dataset.error || '', '').then(ok => { if (ok) flashActionSuccess(btn, null); });
  });
}

/* A button that just did its job says so for a moment: its label reads the
   result, and its icon, if it has one, turns into a tick. With no text, only
   the icon changes. */
export function flashActionSuccess(el, text = 'Done', duration = 1200) {
  if (!el) return;
  const icon = el.querySelector?.('[class*="icon-["]');
  const label = text === null ? null : el.querySelector?.('.bar-action-label, [data-ui~=label]') || el.querySelector?.('span:not([class*="icon-["])') || (icon ? null : el);
  if (el._flashTimer) clearTimeout(el._flashTimer);
  else el._flashOld = { text: label?.textContent, icon: icon?.className };
  if (label) label.textContent = text;
  if (icon) icon.className = icon.className.replace(/icon-\[lucide--[\w-]+\]/, 'icon-[lucide--check]') + (label ? '' : ' text-gi');
  if (label) el.classList.add('text-gi!', 'border-gi!');
  el._flashTimer = setTimeout(() => {
    if (label) label.textContent = el._flashOld.text;
    if (icon) icon.className = el._flashOld.icon;
    el.classList.remove('text-gi!', 'border-gi!');
    delete el._flashTimer;
    delete el._flashOld;
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
      showToast('error', 'Failed to copy to clipboard');
    }
    document.body.removeChild(ta);
  }
  if (ok) {
    if (notify) showToast('success', notify);
    if (triggerEl) flashActionSuccess(triggerEl, 'Copied');
  }
  return ok;
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
  if (notify) showToast('success', notify);
  if (triggerEl) flashActionSuccess(triggerEl, 'Copied');
}
