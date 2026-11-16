import type { JSX } from 'solid-js';
import { useWorkbench } from './context.tsx';
import { Brand } from '../brand/Brand.tsx';

export function WorkbenchHeader(): JSX.Element {
  const { state } = useWorkbench();
  return (
    <header class="mb-5 flex shrink-0 items-center gap-2">
      <h1 class="flex font-display font-semibold">
        <Brand />
      </h1>
      <span id="st-ver" class="font-mono text-xs text-muted-foreground">
        {state.version ? `v${state.version}` : ''}
      </span>
    </header>
  );
}
