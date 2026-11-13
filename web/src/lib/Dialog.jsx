import { createEffect, createUniqueId, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

export function Dialog(props) {
  let dialog, previous;
  const title = createUniqueId();
  createEffect(() => {
    if (props.open) {
      previous = document.activeElement;
      dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
      previous?.focus();
    }
  });
  onCleanup(() => {
    dialog.close();
    previous?.focus();
  });
  return (
    <Portal>
      <dialog
        ref={(element) => {
          dialog = element;
        }}
        id={props.id}
        class={props.dialogClass || 'dialog'}
        aria-labelledby={props.bare ? undefined : title}
        aria-label={props.bare ? props.title : undefined}
        onCancel={(e) => {
          e.preventDefault();
          props.onClose();
        }}
        onClick={(e) => {
          if (e.target === dialog) props.onClose();
        }}
      >
        <Show when={!props.bare} fallback={props.children}>
          <section class={props.class}>
            <header class="flex-row! items-start justify-between gap-2">
              <div class="flex min-w-0 flex-col gap-0.5">
                <h2 id={title}>{props.title}</h2>
                <Show when={props.subtitle}>
                  <span class="text-sm text-muted-foreground">{props.subtitle}</span>
                </Show>
              </div>
              <Show when={props.footer}>
                <button
                  type="button"
                  class="btn"
                  data-variant="ghost"
                  data-size="icon-xs"
                  aria-label="Close (Esc)"
                  title="Close (Esc)"
                  onClick={() => props.onClose()}
                >
                  <span class="icon-[lucide--x] size-3.5" aria-hidden="true" />
                </button>
              </Show>
            </header>
            {props.children}
            <Show
              when={props.footer}
              fallback={
                <button type="button" class="btn" onClick={() => props.onClose()}>
                  Close
                </button>
              }
            >
              <footer class="flex-row! items-center gap-2">{props.footer}</footer>
            </Show>
          </section>
        </Show>
      </dialog>
    </Portal>
  );
}
