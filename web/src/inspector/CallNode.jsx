import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { createResourceRequest } from '../lib/resource-request.ts';
import { callIdentity, callTarget, isCallCycle } from '../lsp/logic.js';
export function CallNode(props) {
  const editor = useEditor();
  const request = createResourceRequest();
  const [toggled, setToggled] = createSignal(null);
  const cycle = () => isCallCycle(props.node, props.ancestors);
  const expanded = () => !cycle() && (toggled() ?? props.root);
  const ancestors = createMemo(() => [...props.ancestors, callIdentity(props.node)]);
  const [children] = createResource(
    () =>
      expanded()
        ? { item: props.node.item, dir: editor.language.state.direction, path: props.path }
        : false,
    (key) => request('api/lsp/calls', { ...key, wait: 30000 }),
  );
  const target = () => callTarget(props.node, editor.language.state.direction);
  async function jump() {
    const location = target();
    await editor.actions.openFile(location.path, { line: location.line });
    editor.actions.flashFind(props.node.name);
  }
  return (
    <div class="ml-3 border-l pl-1">
      <div class="flex items-center gap-1" data-ui="cnode sym">
        <button
          class="btn"
          aria-label={`Expand ${props.node.name}`}
          aria-expanded={expanded()}
          disabled={cycle()}
          onClick={() => setToggled(!expanded())}
        >
          {cycle() ? '↻' : '›'}
        </button>
        <button
          class="btn min-w-0 flex-1 justify-start text-xs"
          title={`${target().path}:${target().line}`}
          onClick={() => void jump()}
        >
          {props.node.name} · {target().line}
          <Show when={props.node.sites?.length > 1}> ×{props.node.sites.length}</Show>
        </button>
      </div>
      <Show when={expanded()}>
        <Show when={children.loading}>
          <p class="p-2">Loading…</p>
        </Show>
        <Show when={children.error}>
          <p role="alert">{children.error.message}</p>
        </Show>
        <Show when={!children.error && children()}>
          {(data) => (
            <>
              <For each={data().nodes}>
                {(node) => (
                  <CallNode node={node} ancestors={ancestors()} root={false} path={props.path} />
                )}
              </For>
              <Show when={!data().nodes?.length}>
                <p class="p-2 text-xs text-muted-foreground">
                  {editor.language.state.direction === 'in'
                    ? 'No callers found'
                    : 'Calls nothing traceable'}
                </p>
              </Show>
            </>
          )}
        </Show>
      </Show>
    </div>
  );
}
