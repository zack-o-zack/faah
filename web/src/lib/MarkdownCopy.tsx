import type { JSX } from 'solid-js';
import { createSignal, onCleanup } from 'solid-js';
import { copyText } from './clipboard.ts';
export function MarkdownCopy(props: { text: string }): JSX.Element {
  const [copied, setCopied] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  async function copy() {
    if (!(await copyText(props.text))) return;
    setCopied(true);
    clearTimeout(timer);
    timer = setTimeout(() => setCopied(false), 1200);
  }
  return (
    <button
      class="btn absolute top-2 right-2"
      data-control="thr-copy"
      data-variant="ghost"
      data-size="icon-xs"
      aria-label={copied() ? 'Copied' : 'Copy code'}
      onClick={() => void copy()}
    >
      <span
        class={`${copied() ? 'icon-[lucide--check] text-gi' : 'icon-[lucide--copy]'} size-3.5`}
        aria-hidden="true"
      />
    </button>
  );
}
