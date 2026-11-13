import { createSignal, For } from 'solid-js';
import { ToastItem } from './ToastItem.jsx';
import { toastConfig } from './toast-model.js';
export function createToastStore() {
  const [items, setItems] = createSignal([]);
  let next = 0;
  const dismiss = (id) => setItems((items) => items.filter((item) => item.id !== id));
  return {
    items,
    dismiss,
    toast(kind, text, duration) {
      const id = ++next;
      setItems((items) => [...items, { id, ...toastConfig(kind, text, duration) }]);
      return () => dismiss(id);
    },
  };
}
// The app shares one notification service; tests can supply a fresh one.
export const notifications = createToastStore();
export const toast = (...args) => notifications.toast(...args);
export function Toaster(props) {
  const service = () => props.store || notifications;
  return (
    <div class="toaster" data-align="end" aria-live="polite">
      <For each={service().items()}>
        {(item) => <ToastItem item={item} dismiss={service().dismiss} />}
      </For>
    </div>
  );
}
