import { esc } from './state.js';

/* Harness and git output wraps the failure in the prompt it echoed and its own
   log. Keep the lines that say what went wrong; otherwise the last line. */
export function errorSummary(text) {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  const said = lines.filter(l => /^(error|fatal)\b/i.test(l)).map(l => l.replace(/^(error|fatal)\b\s*:?\s*/i, ''));
  return [...new Set(said)].join('\n') || lines[lines.length - 1] || '';
}

/* A destructive alert that leads with what went wrong. When the output says
   more than that, a button copies all of it rather than printing it here; the
   click is handled once for every alert (initErrorCopy in ui.js). */
export function errorAlertHtml(text, { title = '', streams = [] } = {}) {
  const full = [String(text || '').trim(), ...streams.filter(([, t]) => t).map(([label, t]) => label + ':\n' + t.trim())].filter(Boolean).join('\n\n');
  const summary = errorSummary(text) || errorSummary(full) || 'It stopped without saying why.';
  const head = title || summary;
  return '<div data-ui="error-alert" class="alert grid-cols-[auto_1fr] gap-x-2.5" data-variant="destructive" role="alert">' +
    '<span class="icon-[lucide--circle-alert] row-span-2 size-4 translate-y-0.5" aria-hidden="true"></span>' +
    '<h2 class="col-start-2 whitespace-pre-wrap wrap-anywhere">' + esc(head) + '</h2>' +
    '<section class="col-start-2 min-w-0 [&_p]:mb-0!">' +
      (title ? '<p class="whitespace-pre-wrap wrap-anywhere">' + esc(summary) + '</p>' : '') +
      (full !== head && full !== summary ? '<button type="button" class="btn -ml-2 mt-1 text-muted-foreground" data-control="copy-error" data-error="' + esc(full) + '" data-variant="ghost" data-size="xs">' +
        '<span class="icon-[lucide--copy] size-3.5" aria-hidden="true"></span><span data-ui="label">Copy full error</span></button>' : '') +
    '</section></div>';
}

/** Shows an error in a container, or hides the container when there is none. */
export function showError(el, text, options) {
  if (!el) return;
  el.innerHTML = text ? errorAlertHtml(text, options) : '';
  el.hidden = !text;
}
