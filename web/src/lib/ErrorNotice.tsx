import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { copyText } from './clipboard.ts';
import { errorSummary, fullError } from './error-summary.ts';
interface ErrorNoticeProps {
  error?: string;
  title?: string;
  streams?: (string | undefined)[][];
  children?: JSX.Element;
}
export function ErrorNotice(props: ErrorNoticeProps): JSX.Element {
  const full = () => fullError(props.error, props.streams);
  const summary = () =>
    errorSummary(props.error) || errorSummary(full()) || 'It stopped without saying why.';
  const head = () => props.title || summary();
  return (
    <Show when={props.error}>
      <div
        data-ui="error-alert"
        class="alert grid-cols-[auto_1fr] gap-x-2.5"
        data-variant="destructive"
        role="alert"
      >
        <span
          class="icon-[lucide--circle-alert] row-span-2 size-4 translate-y-0.5"
          aria-hidden="true"
        />
        <h2 class="col-start-2 whitespace-pre-wrap wrap-anywhere">{head()}</h2>
        <section class="col-start-2 min-w-0 [&_p]:mb-0!">
          <Show when={props.title}>
            <p class="whitespace-pre-wrap wrap-anywhere">{summary()}</p>
          </Show>
          <Show when={full() !== head() && full() !== summary()}>
            <button
              type="button"
              class="btn -ml-2 mt-1 text-muted-foreground"
              data-control="copy-error"
              data-error={full()}
              data-variant="ghost"
              data-size="xs"
              onClick={() => void copyText(full())}
            >
              <span class="icon-[lucide--copy] size-3.5" aria-hidden="true" />
              <span data-ui="label">Copy full error</span>
            </button>
          </Show>
          {props.children}
        </section>
      </div>
    </Show>
  );
}
