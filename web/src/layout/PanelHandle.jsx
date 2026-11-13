import { useEditor } from '../editor/context.jsx';
import { SplitHandle } from '../lib/SplitHandle.jsx';
export function PanelHandle(props) {
  const editor = useEditor();
  const width = () => editor.store.state.layout[props.panel + 'Width'];
  return (
    <div class="w-1 shrink-0 hover:bg-primary" hidden={!editor.store.state.layout[props.panel]}>
      <SplitHandle
        label={props.label}
        value={props.panel === 'left' ? width() : -width()}
        min={props.panel === 'left' ? 170 : -(props.panel === 'right' ? 700 : 900)}
        max={props.panel === 'left' ? 620 : -(props.panel === 'right' ? 200 : 240)}
        onChange={(value) =>
          editor.actions.setPanelWidth(props.panel, props.panel === 'left' ? value : -value)
        }
      />
    </div>
  );
}
