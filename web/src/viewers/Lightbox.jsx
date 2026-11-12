import { createSignal, Show } from 'solid-js';
import { Dialog } from '../lib/Dialog.jsx';
import { useEditor } from '../editor/context.jsx';
export function Lightbox(props) {
  const editor = useEditor();
  const [size, setSize] = createSignal('');
  return (
    <Dialog open onClose={() => props.close()} title="Image preview">
      <div class="flex items-center gap-2">
        <strong>{props.image.path || props.image.alt || 'Image preview'}</strong>
        <button class="btn" onClick={() => props.close()}>
          Close
        </button>
      </div>
      <img
        class="max-w-full max-h-[75vh]"
        src={props.image.src}
        alt={props.image.alt}
        onLoad={(event) =>
          setSize(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight} px`)
        }
      />
      <p>{size()}</p>
      <Show when={props.image.path}>
        <button
          class="btn"
          onClick={() => {
            void editor.actions.openFile(props.image.path);
            props.close();
          }}
        >
          Open in tab
        </button>
      </Show>
      <button
        class="btn"
        onClick={() => navigator.clipboard.writeText(props.image.path || props.image.src)}
      >
        Copy path
      </button>
    </Dialog>
  );
}
