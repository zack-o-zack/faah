import type { JSX } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { InspectorToolbar } from '../inspector/InspectorToolbar.tsx';
import { References } from '../inspector/References.tsx';
import { Symbols } from '../inspector/Symbols.tsx';
import { Calls } from '../inspector/Calls.tsx';
import { Search } from '../search/Search.tsx';
export function RightSidebar(): JSX.Element {
  const editor = useEditor();
  const layout = () => editor.store.state.layout;
  return (
    <aside
      id="right-side"
      hidden={!layout().right}
      style={{ width: layout().rightWidth + 'px' }}
      class="flex shrink-0 flex-col overflow-hidden border-l bg-sidebar"
    >
      <InspectorToolbar />
      <section
        id="pane-right-refs"
        class="flex min-h-0 flex-1 flex-col overflow-hidden"
        hidden={layout().inspector !== 'refs'}
      >
        <References />
      </section>
      <section
        id="pane-right-symbols"
        class="flex min-h-0 flex-1 flex-col overflow-hidden"
        hidden={layout().inspector !== 'symbols'}
      >
        <Symbols />
      </section>
      <section
        id="pane-right-calls"
        class="flex min-h-0 flex-1 flex-col overflow-hidden"
        hidden={layout().inspector !== 'calls'}
      >
        <Calls />
      </section>
      <section
        id="pane-right-search"
        class="flex min-h-0 flex-1 flex-col overflow-hidden"
        hidden={layout().inspector !== 'search'}
      >
        <Search />
      </section>
    </aside>
  );
}
