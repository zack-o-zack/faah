const icons = {
  success: 'icon-[lucide--circle-check]',
  error: 'icon-[lucide--circle-alert]',
  info: 'icon-[lucide--info]',
};
export function toastConfig(kind, text, duration) {
  let config;
  if (icons[kind]) config = { category: kind, icon: icons[kind], title: text };
  else if (kind) config = { category: '', title: kind, description: text };
  else config = { category: '', title: text };
  if (duration !== undefined) config.duration = duration;
  return config;
}
