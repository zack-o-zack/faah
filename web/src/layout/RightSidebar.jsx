import { useEditor } from '../editor/context.jsx';
import { InspectorToolbar } from '../inspector/InspectorToolbar.jsx';
import { References } from '../inspector/References.jsx';
import { Symbols } from '../inspector/Symbols.jsx';
import { Calls } from '../inspector/Calls.jsx';
import { Search } from '../search/Search.jsx';
import { LegacyTips } from '../app/LegacyTips.jsx';
export function RightSidebar() {
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
        class="flex min-h-0 flex-1 flex-col"
        hidden={layout().inspector !== 'refs'}
      >
        <References />
      </section>
      <section
        id="pane-right-symbols"
        class="flex min-h-0 flex-1 flex-col"
        hidden={layout().inspector !== 'symbols'}
      >
        <Symbols />
      </section>
      <section
        id="pane-right-calls"
        class="flex min-h-0 flex-1 flex-col"
        hidden={layout().inspector !== 'calls'}
      >
        <Calls />
      </section>
      <section
        id="pane-right-search"
        class="flex min-h-0 flex-1 flex-col"
        hidden={layout().inspector !== 'search'}
      >
        <Search />
      </section>
      <section
        id="pane-right-tips"
        class="flex min-h-0 flex-1 flex-col overflow-hidden"
        hidden={layout().inspector !== 'tips'}
      >
        <LegacyTips />
      </section>
    </aside>
  );
}
