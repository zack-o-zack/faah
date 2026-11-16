export interface ToastConfig {
  category: string;
  title: string;
  description?: string;
  icon?: string;
  duration?: number;
}
const icons: Record<string, string> = {
  success: 'icon-[ph--check-circle]',
  error: 'icon-[ph--warning-circle]',
  info: 'icon-[ph--info]',
};
export function toastConfig(kind: string, text: string, duration?: number): ToastConfig {
  let config: ToastConfig;
  if (icons[kind]) config = { category: kind, icon: icons[kind], title: text };
  else if (kind) config = { category: '', title: kind, description: text };
  else config = { category: '', title: text };
  if (duration !== undefined) config.duration = duration;
  return config;
}
