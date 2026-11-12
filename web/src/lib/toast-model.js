const icons = { success: 'icon-[lucide--circle-check]', error: 'icon-[lucide--circle-alert]', info: 'icon-[lucide--info]' };
export function toastConfig(kind, text, duration) {
  const config = icons[kind]
    ? { category: kind, icon: icons[kind], title: text }
    : kind ? { category: '', title: kind, description: text } : { category: '', title: text };
  if (duration !== undefined) config.duration = duration;
  return config;
}
