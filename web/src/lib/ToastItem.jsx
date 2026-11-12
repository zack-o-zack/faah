import { createEffect, onCleanup, Show } from 'solid-js';

export function ToastItem(props) {
  createEffect(() => {
    const duration = props.item.duration;
    if (duration === 0 || duration === -1) return;
    const timer = setTimeout(() => props.dismiss(props.item.id), duration ?? 5000);
    onCleanup(() => clearTimeout(timer));
  });
  return (
    <div class="toast" role={props.item.category === 'error' ? 'alert' : 'status'}>
      <div class="toast-content">
        <Show when={props.item.icon}>
          <span class={`${props.item.icon} size-4`} aria-hidden="true" />
        </Show>
        <section>
          <h2>{props.item.title}</h2>
          <Show when={props.item.description}>
            <p>{props.item.description}</p>
          </Show>
        </section>
        <footer>
          <button
            class="btn"
            data-variant="ghost"
            aria-label="Dismiss notification"
            onClick={() => props.dismiss(props.item.id)}
          >
            <span class="icon-[lucide--x] size-4" aria-hidden="true" />
          </button>
        </footer>
      </div>
    </div>
  );
}
