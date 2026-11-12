import { createSignal } from 'solid-js';
import { useWorkbench } from './context.jsx';
export function NewFolderForm(props) {
  const { actions } = useWorkbench();
  const [name, setName] = createSignal('');
  return (
    <form
      class="flex gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (name().trim() && (await actions.mkdir(name().trim()))) {
          props.onDone();
        }
      }}
    >
      <input
        class="input"
        aria-label="New folder name or path"
        placeholder="Folder name, or a path like ~/code/new-project"
        ref={(el) => queueMicrotask(() => el.focus())}
        value={name()}
        onInput={(e) => setName(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            props.onDone();
          }
        }}
      />
      <button class="btn">Create folder</button>
    </form>
  );
}
