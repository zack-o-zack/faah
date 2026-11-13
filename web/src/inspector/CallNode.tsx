import type { CallNode as Node } from '../lsp/decode.ts';
import { decodeCalls } from '../lsp/decode.ts';

interface CallNodeProps {
  node: Node;
  ancestors: string[];
  root?: boolean;
  path: string;
}
import type { JSX } from 'solid-js';
import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { createResourceRequest } from '../lib/resource-request.ts';
import { callIdentity, callTarget, isCallCycle } from '../lsp/logic.ts';
export function CallNode(props: CallNodeProps): JSX.Element {
  const editor = useEditor();
  const request = createResourceRequest();
  const [toggled, setToggled] = createSignal<boolean | null>(null);
  const cycle = () => isCallCycle(props.node, props.ancestors);
  const expanded = () => !cycle() && (toggled() ?? props.root);
  const ancestors = createMemo(() => [...props.ancestors, callIdentity(props.node)]);
  const [children] = createResource(
    () =>
      expanded()
        ? { item: props.node.item, dir: editor.language.state.direction, path: props.path }
        : false,
    (key) => request('api/lsp/calls', { ...key, wait: 30000 }).then(decodeCalls),
  );
  const target = () => callTarget(props.node, editor.language.state.direction);
  async function jump() {
    const location = target();
    await editor.actions.openFile(location.path, { line: location.line });
    editor.actions.flashFind(props.node.name);
  }
  return (
    <div>
      <div
        class="flex min-w-0 items-center gap-2 p-2 cursor-pointer hover:bg-accent [&.sel]:bg-accent"
        data-ui="cnode sym"
        style={{ 'padding-left': `${6 + props.ancestors.length * 14}px` }}
        // aislop-ignore-next-line jsx-a11y/prefer-tag-over-role -- The navigable row contains a separate expand button.
        role="button"
        tabindex="0"
        title={`${target().path}:${target().line}${props.node.detail ? '\n' + props.node.detail : ''}`}
        onClick={() => void jump()}
        onKeyDown={(event) => {
          if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) {
            event.preventDefault();
            void jump();
          }
        }}
      >
        <button
          class="w-4 shrink-0 cursor-pointer text-muted-foreground"
          data-ui="car"
          aria-label={`Expand ${props.node.name}`}
          aria-expanded={expanded()}
          disabled={cycle()}
          onClick={(event) => {
            event.stopPropagation();
            setToggled(!expanded());
          }}
        >
          <span
            class={arrowIcon(cycle(), children.loading, !!expanded()) + ' size-3'}
            aria-hidden="true"
          />
        </button>
        <span class="badge" data-variant="secondary" data-k={props.node.kind}>
          {props.node.kind}
        </span>
        <span data-ui="sn" class="truncate">
          {props.node.name}
        </span>
        <span data-ui="sl" class="ml-auto font-mono text-muted-foreground">
          {target().path.split('/').pop()}:{target().line}
          <Show when={(props.node.sites?.length || 0) > 1}> ×{props.node.sites?.length}</Show>
        </span>
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
                <p
                  data-ui="cnone"
                  class="p-3 text-muted-foreground"
                  style={{ 'padding-left': `${26 + (props.ancestors.length + 1) * 14}px` }}
                >
                  {editor.language.state.direction === 'in'
                    ? 'no callers found'
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

function arrowIcon(cycle: boolean, loading: boolean, expanded: boolean): string {
  if (cycle) return 'icon-[lucide--repeat]';
  if (loading) return 'icon-[lucide--loader-circle] animate-spin';
  return expanded ? 'icon-[lucide--chevron-down]' : 'icon-[lucide--chevron-right]';
}
