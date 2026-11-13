import { createEffect, onCleanup, Show } from 'solid-js';

export function ToastItem(props) {
  const color = () =>
    ({ success: 'text-gi', error: 'text-destructive' })[props.item.category] ||
    'text-muted-foreground';
  createEffect(() => {
    const duration = props.item.duration;
    if (duration === 0 || duration === -1) return;
    const timer = setTimeout(() => props.dismiss(props.item.id), duration ?? 5000);
    onCleanup(() => clearTimeout(timer));
  });
  return (
    <div
      class="toast"
      data-category={props.item.category || undefined}
      aria-atomic="true"
      role={props.item.category === 'error' ? 'alert' : 'status'}
    >
      <div class="toast-content">
        <Show when={props.item.icon}>
          <span class={`${props.item.icon} size-4 shrink-0 ${color()}`} aria-hidden="true" />
        </Show>
        <section>
          <h2>{props.item.title}</h2>
          <Show when={props.item.description}>
            <p>{props.item.description}</p>
          </Show>
        </section>
      </div>
    </div>
  );
}
