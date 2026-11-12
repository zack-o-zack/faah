import { createEffect, createUniqueId, onCleanup } from 'solid-js';
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
        class="dialog"
        aria-labelledby={title}
        onCancel={(e) => {
          e.preventDefault();
          props.onClose();
        }}
        onClick={(e) => {
          if (e.target === dialog) props.onClose();
        }}
      >
        <section>
          <header>
            <h2 id={title}>{props.title}</h2>
          </header>
          {props.children}
          <button type="button" class="btn" onClick={() => props.onClose()}>
            Close
          </button>
        </section>
      </dialog>
    </Portal>
  );
}
