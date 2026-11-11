import { esc } from './state.js';

export function toastMarkup(title, description) {
  return '<div class="toast" role="status" aria-hidden="false"><div class="toast-content"><section><h2>' + esc(title || '') + '</h2><p>' + esc(description) + '</p></section></div></div>';
}
