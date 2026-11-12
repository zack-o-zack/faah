import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { api } from '../lib/api.js';
import { createPolling } from '../lib/events.js';
import { holdingUpdate } from './logic.js';
export function Holding(props) {
  const data = () => props.data;
  const [polledProgress, setProgress] = createSignal();
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
          const update = holdingUpdate(state.items, location.pathname);
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
        <header>
          <img class="hidden h-5 dark:block" src="static/logo-dark.svg" alt="faah" />
          <img class="h-5 dark:hidden" src="static/logo-light.svg" alt="faah" />
        </header>
        <section class="flex items-center gap-3">
          <span
            class={
              data().PR
                ? 'icon-[lucide--git-pull-request] size-5 text-gi'
                : 'icon-[lucide--folder] size-5'
            }
          />
          <div class="min-w-0">
            <h1 class="truncate font-medium">{data().Title}</h1>
            <Show when={data().Sub}>
              <p class="truncate font-mono text-xs text-muted-foreground">{data().Sub}</p>
            </Show>
          </div>
        </section>
        <Show
          when={data().Starting}
          fallback={
            <div class="alert" data-variant="destructive" role="alert">
              <h2>Could not open it</h2>
              <p class="whitespace-pre-wrap wrap-anywhere font-mono text-xs">{data().Error}</p>
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
            <a class="btn" data-variant="primary" href={data().Retry}>
              Retry
            </a>
          </Show>
          <Show when={data().Choose}>
            <a class="btn" data-variant="primary" href={data().Choose}>
              Choose a clone
            </a>
          </Show>
          <a class="btn" data-variant="ghost" href={data().Base}>
            Back to workbench
          </a>
        </footer>
      </main>
    </>
  );
}
