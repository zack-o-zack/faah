import type { HoldingPage } from './decode.ts';
import type { Request } from '../lib/api.ts';
import { record } from '../lib/decode.ts';

interface HoldingProps {
  data: HoldingPage;
  request?: Request;
  reload?: () => void;
}
import type { JSX } from 'solid-js';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { api } from '../lib/api.ts';
import { createPolling } from '../lib/events.ts';
import { holdingUpdate } from './logic.ts';
export function Holding(props: HoldingProps): JSX.Element {
  const data = () => props.data;
  const [polledProgress, setProgress] = createSignal<string>();
  const progress = () => polledProgress() ?? data().Progress;
  onMount(() => {
    if (!data().Starting) return;
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    createPolling(
      async () => {
        try {
          const state = await (props.request || api)('api/wb/state', null, {
            signal: controller.signal,
            cache: 'no-store',
            timeout: 10000,
          });
          if (controller.signal.aborted) return;
          const update = holdingUpdate(record(state).items, location.pathname);
          if (update.reload) (props.reload || (() => location.replace(location.href)))();
          else if (update.progress) setProgress(update.progress);
        } catch {
          // Keep the spinner through a temporary connection error.
        }
      },
      1000,
      false,
    );
  });
  return (
    <>
      <button
        data-desktop-menu
        class="btn desktop-menu-btn hidden! win-linux:inline-flex!"
        aria-label="Application menu"
      >
        <span class="icon-[lucide--menu] size-4" />
      </button>
      <main
        class={`mx-auto flex min-h-dvh w-full max-w-[560px] flex-col
        justify-center gap-6 px-4 pb-[12vh]`}
      >
        <header class="flex">
          <img class="hidden h-5 dark:block" src="static/logo-dark.svg" alt="faah" />
          <img class="h-5 dark:hidden" src="static/logo-light.svg" alt="faah" />
        </header>
        <section class="flex items-center gap-3">
          <figure class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
            <span
              class={
                data().PR
                  ? 'icon-[lucide--git-pull-request] size-5 text-gi'
                  : 'icon-[lucide--folder] size-5 text-muted-foreground'
              }
            />
          </figure>
          <div class="flex min-w-0 flex-col">
            <h1 class="truncate font-medium">{data().Title}</h1>
            <Show when={data().Sub}>
              <p class="truncate font-mono text-xs text-muted-foreground">{data().Sub}</p>
            </Show>
          </div>
        </section>
        <Show
          when={data().Starting}
          fallback={
            <div
              class="alert grid-cols-[auto_1fr] gap-x-2.5"
              data-variant="destructive"
              role="alert"
            >
              <span
                class="icon-[lucide--circle-alert] row-span-2 size-4 translate-y-0.5"
                aria-hidden="true"
              />
              <h2 class="col-start-2">Could not open it</h2>
              <section class="col-start-2 min-w-0">
                <p class="whitespace-pre-wrap wrap-anywhere font-mono text-xs">{data().Error}</p>
              </section>
            </div>
          }
        >
          <p class="flex items-start gap-2 text-sm text-muted-foreground" role="status">
            <span
              class={`icon-[lucide--loader-circle] size-4 shrink-0 animate-spin
        motion-reduce:animate-none`}
              aria-hidden="true"
            />
            {progress()
              ? `${progress()}…`
              : 'Opening… Pull requests are checked out first, so large repositories take a while.'}
          </p>
        </Show>
        <footer class="flex flex-wrap gap-2">
          <Show when={data().Retry}>
            <a class="btn" data-variant="primary" data-size="sm" href={data().Retry}>
              Retry
            </a>
          </Show>
          <Show when={data().Choose}>
            <a class="btn" data-variant="primary" data-size="sm" href={data().Choose}>
              Choose a clone
            </a>
          </Show>
          <a class="btn first:-ms-2.5" data-variant="ghost" data-size="sm" href={data().Base}>
            <span class="icon-[lucide--arrow-left] size-4" aria-hidden="true" />
            Back to workbench
          </a>
        </footer>
      </main>
    </>
  );
}
