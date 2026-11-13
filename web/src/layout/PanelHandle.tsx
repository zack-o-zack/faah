import type { PanelName } from './logic.ts';
interface PanelHandleProps {
  panel: PanelName;
  label: string;
}
import type { JSX } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { SplitHandle } from '../lib/SplitHandle.tsx';
export function PanelHandle(props: PanelHandleProps): JSX.Element {
  const editor = useEditor();
  const widthKey = (): 'leftWidth' | 'rightWidth' | 'threadsWidth' => {
    if (props.panel === 'left') return 'leftWidth';
    return props.panel === 'right' ? 'rightWidth' : 'threadsWidth';
  };
  const width = () => editor.store.state.layout[widthKey()];
  return (
    <div
      class={`${props.panel === 'left' ? '-ml-0.5' : '-mr-0.5'} w-1 shrink-0 cursor-col-resize z-10 hover:bg-primary [&.drag]:bg-primary`}
      hidden={!editor.store.state.layout[props.panel]}
    >
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
