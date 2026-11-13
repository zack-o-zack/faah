import type { JSX } from 'solid-js';
import { useWorkbench } from './context.tsx';

export function WorkbenchHeader(): JSX.Element {
  const { state } = useWorkbench();
  return (
    <header class="mb-5 flex shrink-0 items-center gap-2">
      <h1 class="flex">
        <img
          class="hidden h-5 w-auto dark:block"
          src="static/logo-dark.svg"
          alt="faah"
          width="35"
          height="13"
        />
        <img
          class="block h-5 w-auto dark:hidden"
          src="static/logo-light.svg"
          alt="faah"
          width="35"
          height="13"
        />
      </h1>
      <span id="st-ver" class="font-mono text-xs text-muted-foreground">
        {state.version ? `v${state.version}` : ''}
      </span>
    </header>
  );
}
