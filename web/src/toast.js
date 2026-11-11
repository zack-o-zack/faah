import { esc } from './state.js';

// A toast's kind picks its icon; any other first argument is shown as a heading.
const KIND_ICONS = {
  success: '<span class="icon-[lucide--circle-check] size-4 text-gi" aria-hidden="true"></span>',
  error: '<span class="icon-[lucide--circle-alert] size-4 text-destructive" aria-hidden="true"></span>',
  info: '<span class="icon-[lucide--info] size-4 text-muted-foreground" aria-hidden="true"></span>',
};

export function toastMarkup(kind, description) {
  const glyph = KIND_ICONS[kind];
  const heading = glyph || !kind ? '' : '<h2>' + esc(kind) + '</h2>';
  return '<div class="toast" role="status" aria-hidden="false"><div class="toast-content">' + (glyph || '') +
    '<section>' + heading + '<p>' + esc(description) + '</p></section></div></div>';
}
