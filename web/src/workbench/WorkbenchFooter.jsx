import { useWorkbench } from './context.jsx';
import { MetricsMenu } from './MetricsMenu.jsx';
import { ThemeMenu } from './ThemeMenu.jsx';
export function WorkbenchFooter(props) {
  const { state } = useWorkbench();
  return (
    <footer
      class={`flex shrink-0 items-center gap-2 border-t bg-sidebar px-2 py-1
        text-xs text-muted-foreground`}
    >
      <span>{state.items.filter((item) => item.state === 'running').length} running</span>
      <span class="flex-1" />
      <MetricsMenu metrics={props.metrics} />
      <a
        class="btn"
        data-variant="ghost"
        href="https://github.com/zack-o-zack/faah"
        target="_blank"
        rel="noopener"
        aria-label="faah on GitHub"
      >
        <span class="icon-[lucide--github] size-4" />
      </a>
      <ThemeMenu />
    </footer>
  );
}
