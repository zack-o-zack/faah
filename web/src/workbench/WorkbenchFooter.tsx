import type { WorkbenchMetrics } from './decode.ts';

interface WorkbenchFooterProps {
  metrics?: WorkbenchMetrics | null;
}
import type { JSX } from 'solid-js';
import { useWorkbench } from './context.tsx';
import { MetricsMenu } from './MetricsMenu.tsx';
import { ThemeMenu } from './ThemeMenu.tsx';
import { Show } from 'solid-js';
export function WorkbenchFooter(props: WorkbenchFooterProps): JSX.Element {
  const { state } = useWorkbench();
  return (
    <footer
      id="status"
      class="flex shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap border-t bg-sidebar px-2 py-1 font-mono text-xs text-muted-foreground select-none [&>*]:shrink-0 [&_.metric-label]:max-[560px]:hidden"
    >
      <span id="st-running" class="inline-flex items-center gap-1.5 empty:hidden">
        <Show when={state.items.some((item) => item.state === 'running')}>
          <span class="size-1.5 rounded-full bg-gi" />
          {state.items.filter((item) => item.state === 'running').length} running
        </Show>
      </span>
      <span class="flex-1" />
      <MetricsMenu metrics={props.metrics} />
      <span class="h-3 w-px bg-border" />
      <a
        class="btn"
        data-variant="ghost"
        data-size="icon-xs"
        href="https://github.com/zack-o-zack/faah"
        target="_blank"
        rel="noopener"
        aria-label="faah on GitHub"
      >
        <span class="icon-[lucide--github] size-3.5 shrink-0" aria-hidden="true" />
      </a>
      <ThemeMenu />
    </footer>
  );
}
