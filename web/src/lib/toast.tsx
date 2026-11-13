import type { JSX } from 'solid-js';
import type { ToastConfig } from './toast-model.ts';
export interface ToastItemModel extends ToastConfig {
  id: number;
}
export type ToastStore = ReturnType<typeof createToastStore>;
import { createSignal, For } from 'solid-js';
import { ToastItem } from './ToastItem.tsx';
import { toastConfig } from './toast-model.ts';
export function createToastStore() {
  const [items, setItems] = createSignal<ToastItemModel[]>([]);
  let next = 0;
  const dismiss = (id: number) => setItems((items) => items.filter((item) => item.id !== id));
  return {
    items,
    dismiss,
    toast(kind: string, text: string, duration?: number) {
      const id = ++next;
      setItems((items) => [...items, { id, ...toastConfig(kind, text, duration) }]);
      return () => dismiss(id);
    },
  };
}
// The app shares one notification service; tests can supply a fresh one.
export const notifications = createToastStore();
export const toast = (...args: Parameters<typeof toastConfig>) => notifications.toast(...args);
export function Toaster(props: { store?: ToastStore }): JSX.Element {
  const service = () => props.store || notifications;
  return (
    <div
      id="toaster"
      class="toaster top-[var(--titlebar-h,0px)] bottom-auto flex-col [&_.toast]:animate-[toast-down_0.3s_ease-in-out]"
      data-align="end"
      aria-live="polite"
    >
      <For each={service().items()}>
        {(item) => <ToastItem item={item} dismiss={service().dismiss} />}
      </For>
    </div>
  );
}
