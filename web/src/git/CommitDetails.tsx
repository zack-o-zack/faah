import { decodeCommitDetail } from './decode.ts';

interface CommitDetailsProps {
  sha: string;
  sideWidth: number;
  children: (hover: {
    onMouseEnter: (event: MouseEvent) => void;
    onMouseLeave: () => void;
    hide: () => void;
  }) => JSX.Element;
}
import type { JSX } from 'solid-js';
import { createResource, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { createResourceRequest } from '../lib/resource-request.ts';
import { copyText } from '../lib/clipboard.ts';
export function CommitDetails(props: CommitDetailsProps): JSX.Element {
  const request = createResourceRequest();
  const [open, setOpen] = createSignal(false);
  const [position, setPosition] = createSignal({ left: '8px', top: '8px' });
  const [copied, setCopied] = createSignal(false);
  const [detail] = createResource(
    () => open() && props.sha,
    (sha) => request('api/commitdetail', { sha }).then(decodeCommitDetail),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  let pointerY = 0;
  const hide = () => {
    clearTimeout(timer);
    clearTimeout(leaveTimer);
    setOpen(false);
  };
  const enter = (event: MouseEvent) => {
    clearTimeout(leaveTimer);
    pointerY = event.clientY;
    clearTimeout(timer);
    timer = setTimeout(() => setOpen(true), 350);
  };
  const leave = () => {
    clearTimeout(timer);
    leaveTimer = setTimeout(hide, 180);
  };
  onMount(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    document.addEventListener('keydown', key);
    onCleanup(() => document.removeEventListener('keydown', key));
  });
  onCleanup(() => {
    clearTimeout(timer);
    clearTimeout(leaveTimer);
    clearTimeout(copiedTimer);
  });
  return (
    <>
      {props.children({ onMouseEnter: enter, onMouseLeave: leave, hide })}
      <Show when={open() && !detail.error && detail()}>
        {(data) => (
          <Portal>
            <div
              id="commitcard"
              class="card fixed z-[60] max-w-[480px] max-h-[70vh] overflow-auto"
              style={position()}
              ref={(element) =>
                queueMicrotask(() => {
                  const bounds = element.getBoundingClientRect();
                  setPosition({
                    left:
                      Math.max(8, Math.min(props.sideWidth + 8, innerWidth - bounds.width - 8)) +
                      'px',
                    top:
                      Math.max(8, Math.min(pointerY - 12, innerHeight - bounds.height - 8)) + 'px',
                  });
                })
              }
              onMouseEnter={() => clearTimeout(leaveTimer)}
              onMouseLeave={leave}
            >
              <div data-ui="cc-head" class="flex items-center gap-2 p-3">
                <span data-ui="cc-sha" class="font-mono text-primary-text" title={data().hash}>
                  {data().short}
                </span>
                <span class="flex-1 min-w-0" />
                <button
                  type="button"
                  title="Copy the full SHA"
                  class="btn"
                  data-control="cc-copy"
                  data-variant="outline"
                  data-size="xs"
                  onClick={async () => {
                    if (await copyText(data().hash || props.sha, 'Copied ' + data().short)) {
                      setCopied(true);
                      clearTimeout(copiedTimer);
                      copiedTimer = setTimeout(() => setCopied(false), 1200);
                    }
                  }}
                >
                  {copied() ? 'Copied' : 'Copy SHA'}
                </button>
              </div>
              <div
                data-ui="cc-meta"
                class="flex items-center flex-wrap gap-2 p-3 text-muted-foreground"
              >
                <Show
                  when={data().authorUrl}
                  fallback={
                    <span data-ui="cc-who" class="font-semibold" title={data().email}>
                      {data().author}
                    </span>
                  }
                >
                  <a
                    data-ui="cc-who"
                    class="font-semibold"
                    href={data().authorUrl}
                    target="_blank"
                    rel="noopener"
                  >
                    {data().author}
                  </a>
                </Show>
                <span data-ui="cc-dot" class="text-muted-foreground">
                  ·
                </span>
                <span class="cc-date" title={data().dateIso}>
                  {data().date}
                </span>
              </div>
              <div
                data-ui="cc-msg"
                class="overflow-x-hidden overflow-y-auto whitespace-pre-wrap p-3 font-mono"
              >
                {data().message || data().subject}
              </div>
              <Show when={data().files || data().insertions || data().deletions}>
                <div data-ui="cc-stat" class="flex items-center gap-2 p-3 font-mono">
                  <Show when={data().files}>
                    <span data-ui="cc-files" class="text-muted-foreground">
                      {data().files} {data().files === 1 ? 'file' : 'files'}
                    </span>
                  </Show>
                  <Show when={data().insertions}>
                    <span data-ui="cc-add" class="text-gi">
                      +{data().insertions}
                    </span>
                  </Show>
                  <Show when={data().deletions}>
                    <span data-ui="cc-del" class="text-gd">
                      −{data().deletions}
                    </span>
                  </Show>
                </div>
              </Show>
            </div>
          </Portal>
        )}
      </Show>
    </>
  );
}
