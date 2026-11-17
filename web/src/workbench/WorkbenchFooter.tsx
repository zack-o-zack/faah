import type { WorkbenchMetrics } from './decode.ts';

interface WorkbenchFooterProps {
  metrics?: WorkbenchMetrics | null;
}
import type { JSX } from 'solid-js';
import { MetricsMenu } from './MetricsMenu.tsx';
import { useTheme } from '../lib/theme-context.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';
export function WorkbenchFooter(props: WorkbenchFooterProps): JSX.Element {
  const theme = useTheme();
  return (
    <footer
      id="status"
      class="flex shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap border-t bg-sidebar px-2 py-1 font-mono text-xs text-muted-foreground select-none [&>*]:shrink-0"
    >
      <span class="flex-1" />
      <MetricsMenu metrics={props.metrics} />
      <span class="h-3 w-px bg-border" />
      <a
        class="btn text-muted-foreground"
        data-variant="ghost"
        data-size="icon-xs"
        href="https://github.com/zack-o-zack/faah"
        target="_blank"
        rel="noopener"
        aria-label="fibo on GitHub"
      >
        <span class="icon-[simple-icons--github] shrink-0" aria-hidden="true" />
      </a>
      <ThemeToggle value={theme.preference()} onChange={(id) => theme.setTheme(id)} />
    </footer>
  );
}
