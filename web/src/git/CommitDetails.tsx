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
import { authorInitial, commitMessageBody } from './commit-message.ts';

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
              class="fixed z-[60] flex max-h-[70vh] w-[340px] flex-col gap-2 overflow-auto rounded-[var(--radius-md)] border p-3 text-foreground shadow-pop"
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
              <div class="font-semibold text-13 leading-[1.35]">{data().subject}</div>
              <Show when={commitMessageBody(data().message)}>
                {(body) => (
                  <div class="whitespace-pre-wrap text-12-5 leading-[1.45] text-muted-foreground">
                    {body()}
                  </div>
                )}
              </Show>
              <div class="flex items-center gap-1.5 text-12">
                <span
                  class="grid size-[18px] shrink-0 place-items-center rounded-full bg-(--hover) text-[10.5px] font-semibold"
                  aria-hidden="true"
                >
                  {authorInitial(data().author)}
                </span>
                <Show
                  when={data().authorUrl}
                  fallback={
                    <span class="font-semibold" title={data().email}>
                      {data().author}
                    </span>
                  }
                >
                  <a class="font-semibold" href={data().authorUrl} target="_blank" rel="noopener">
                    {data().author}
                  </a>
                </Show>
                <span class="text-muted-foreground">·</span>
                <span class="text-muted-foreground" title={data().dateIso}>
                  {data().date}
                </span>
              </div>
              <div class="flex items-center gap-2 border-t pt-2 font-mono text-12">
                <button
                  type="button"
                  class="inline-flex items-center gap-[5px] rounded-pill border px-2 py-0.5 text-12"
                  title="Copy the full SHA"
                  onClick={async () => {
                    if (await copyText(data().hash || props.sha, 'Copied ' + data().short)) {
                      setCopied(true);
                      clearTimeout(copiedTimer);
                      copiedTimer = setTimeout(() => setCopied(false), 1200);
                    }
                  }}
                >
                  <span
                    class={copied() ? 'icon-[ph--check]' : 'icon-[ph--copy]'}
                    aria-hidden="true"
                  />
                  {copied() ? 'Copied' : data().short}
                </button>
                <span class="flex-1" />
                <Show when={data().files || data().insertions || data().deletions}>
                  <Show when={data().files}>
                    <span class="text-muted-foreground">
                      {data().files} {data().files === 1 ? 'file' : 'files'}
                    </span>
                  </Show>
                  <Show when={data().insertions}>
                    <span class="text-gi">+{data().insertions}</span>
                  </Show>
                  <Show when={data().deletions}>
                    <span class="text-gd">−{data().deletions}</span>
                  </Show>
                </Show>
              </div>
            </div>
          </Portal>
        )}
      </Show>
    </>
  );
}
