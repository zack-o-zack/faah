import { createMemo, For, Match, Show, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { citation, inlineMarkdown, markdownBlocks } from './markdown-model.ts';
import { linkTarget } from '../threads/references.ts';
import { copyText } from './clipboard.ts';
export function Markdown(props) {
  const blocks = createMemo((previous) => markdownBlocks(props.text, previous));
  return (
    <div class="thr-body min-w-0 break-words">
      <Blocks blocks={blocks()} refs={props.refs} onOpen={props.onOpen} />
    </div>
  );
}
function Blocks(props) {
  return (
    <For each={props.blocks}>
      {(block) => (
        <Switch>
          <Match when={block.type === 'code'}>
            <div class="thr-pre relative">
              <Show when={block.lang}>
                <span class="text-xs text-muted-foreground">{block.lang}</span>
              </Show>
              <pre>
                <code>{block.text}</code>
              </pre>
              <button
                class="btn absolute right-1 top-1"
                aria-label="Copy code"
                onClick={() => void copyText(block.text)}
              >
                Copy
              </button>
            </div>
          </Match>
          <Match when={block.type === 'heading'}>
            <Dynamic component={'h' + block.level}>
              <Inline text={block.text} refs={props.refs} onOpen={props.onOpen} />
            </Dynamic>
          </Match>
          <Match when={block.type === 'hr'}>
            <hr />
          </Match>
          <Match when={block.type === 'quote'}>
            <blockquote classList={{ 'thr-alert': !!block.alert }}>
              <Show when={block.alert}>
                <strong>{block.alert}</strong>
              </Show>
              <Blocks blocks={block.blocks} refs={props.refs} onOpen={props.onOpen} />
            </blockquote>
          </Match>
          <Match when={block.type === 'list'}>
            <Dynamic component={block.ordered ? 'ol' : 'ul'}>
              <For each={block.items}>
                {(item) => (
                  <li>
                    <Show when={item.checked !== null}>
                      <input type="checkbox" disabled checked={item.checked} />
                    </Show>
                    <Blocks blocks={item.blocks} refs={props.refs} onOpen={props.onOpen} />
                  </li>
                )}
              </For>
            </Dynamic>
          </Match>
          <Match when={block.type === 'table'}>
            <table>
              <thead>
                <tr>
                  <For each={block.header}>
                    {(cell, index) => (
                      <th style={{ 'text-align': block.align[index()] }}>
                        <Inline text={cell} refs={props.refs} onOpen={props.onOpen} />
                      </th>
                    )}
                  </For>
                </tr>
              </thead>
              <tbody>
                <For each={block.rows}>
                  {(row) => (
                    <tr>
                      <For each={block.header}>
                        {(_, index) => (
                          <td style={{ 'text-align': block.align[index()] }}>
                            <Inline
                              text={row[index()] || ''}
                              refs={props.refs}
                              onOpen={props.onOpen}
                            />
                          </td>
                        )}
                      </For>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </Match>
          <Match when={block.type === 'paragraph'}>
            <p class="whitespace-pre-wrap">
              <Inline text={block.text} refs={props.refs} onOpen={props.onOpen} />
            </p>
          </Match>
        </Switch>
      )}
    </For>
  );
}
function Inline(props) {
  const parts = createMemo(() => inlineMarkdown(props.text));
  return <Parts parts={parts()} refs={props.refs} onOpen={props.onOpen} />;
}
function Parts(props) {
  return (
    <For each={props.parts}>
      {(part) => (
        <Switch fallback={part.text}>
          <Match when={['strong', 'em', 'del'].includes(part.type)}>
            <Dynamic component={part.type}>
              <Parts parts={part.children} refs={props.refs} onOpen={props.onOpen} />
            </Dynamic>
          </Match>
          <Match when={part.type === 'code'}>
            <code>
              <Link value={part.text} refs={props.refs} onOpen={props.onOpen}>
                {part.text}
              </Link>
            </code>
          </Match>
          <Match when={part.type === 'link'}>
            <Link value={part.url} refs={props.refs} onOpen={props.onOpen}>
              <Parts parts={part.children} refs={props.refs} onOpen={props.onOpen} />
            </Link>
          </Match>
          <Match when={part.type === 'image'}>
            <Show when={part.url} fallback={part.text}>
              <img
                loading="lazy"
                alt={part.text}
                src={
                  /^(https?:|\/)/.test(part.url)
                    ? part.url
                    : 'api/raw?path=' + encodeURIComponent(part.url)
                }
              />
            </Show>
          </Match>
        </Switch>
      )}
    </For>
  );
}
function Link(props) {
  const file = () => citation(props.value);
  const target = () => {
    const found = file();
    return found ? linkTarget(props.refs, props.value, found.path, found.line, found.end) : null;
  };
  return (
    <Show
      when={target() && props.onOpen}
      fallback={
        <Show when={!file() && /^(https?:|mailto:|#)/.test(props.value)} fallback={props.children}>
          <a href={props.value} target="_blank" rel="noopener noreferrer">
            {props.children}
          </a>
        </Show>
      }
    >
      <button
        class="cursor-pointer text-primary-text underline"
        onClick={() => props.onOpen(target())}
      >
        {props.children}
      </button>
    </Show>
  );
}
