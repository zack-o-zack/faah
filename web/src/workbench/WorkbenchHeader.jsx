import { useWorkbench } from './context.jsx';

export function WorkbenchHeader() {
  const { state } = useWorkbench();
  return (
    <header class="flex items-center gap-2">
      <img class="hidden h-5 dark:block" src="static/logo-dark.svg" alt="faah" />
      <img class="h-5 dark:hidden" src="static/logo-light.svg" alt="faah" />
      <span class="text-xs text-muted-foreground">{state.version ? `v${state.version}` : ''}</span>
    </header>
  );
}
