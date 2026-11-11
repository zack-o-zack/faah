// A toast's kind picks its icon and category; any other first argument is shown as a heading.
const KIND_ICONS = {
  success: '<span class="icon-[lucide--circle-check] size-4 shrink-0 text-gi" aria-hidden="true"></span>',
  error: '<span class="icon-[lucide--circle-alert] size-4 shrink-0 text-destructive" aria-hidden="true"></span>',
  info: '<span class="icon-[lucide--info] size-4 shrink-0 text-muted-foreground" aria-hidden="true"></span>',
};

/** Options for Basecoat's toaster.toast(), which escapes the text itself. */
export function toastConfig(kind, text, duration) {
  const icon = KIND_ICONS[kind];
  const config = icon
    ? { category: kind, icon, title: text }
    : kind ? { category: '', title: kind, description: text } : { category: '', title: text };
  if (duration !== undefined) config.duration = duration;
  return config;
}
