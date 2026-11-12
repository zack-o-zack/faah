import { createSignal, For, onCleanup, Show } from 'solid-js';
import { toastConfig } from './toast-model.js';
export function createToastStore() {
  const [items, setItems] = createSignal([]);
  let next = 0;
  const dismiss = id => setItems(items => items.filter(item => item.id !== id));
  return { items, dismiss, toast(kind, text, duration) {
    const id = ++next;
    setItems(items => [...items, { id, ...toastConfig(kind, text, duration) }]);
    return () => dismiss(id);
  } };
}
// The bridge and providers share this notification service; tests can supply a fresh one.
export const notifications = createToastStore();
export const toast = (...args) => notifications.toast(...args);
function ToastItem(props) {
  const timer = props.item.duration === 0 || props.item.duration === -1 ? null : setTimeout(() => props.dismiss(props.item.id), props.item.duration ?? 5000);
  onCleanup(() => clearTimeout(timer));
  return <div class="toast" role={props.item.category === 'error' ? 'alert' : 'status'}>
    <div class="toast-content"><Show when={props.item.icon}><span class={`${props.item.icon} size-4`} aria-hidden="true" /></Show>
    <section><h2>{props.item.title}</h2><Show when={props.item.description}><p>{props.item.description}</p></Show></section>
    <footer><button class="btn" data-variant="ghost" aria-label="Dismiss notification" onClick={() => props.dismiss(props.item.id)}><span class="icon-[lucide--x] size-4" aria-hidden="true" /></button></footer></div>
  </div>;
}
export function Toaster(props) {
  const service = props.store || notifications;
  return <div class="toaster" data-align="end" aria-live="polite"><For each={service.items()}>{item => <ToastItem item={item} dismiss={service.dismiss} />}</For></div>;
}
