import type { JSX } from 'solid-js';
interface HoverActionProps {
  id: string;
  title: string;
  children: JSX.Element;
  onAction: () => unknown;
}
export function HoverAction(props: HoverActionProps): JSX.Element {
  return (
    <button
      id={props.id}
      title={props.title}
      class="btn"
      data-variant="ghost"
      data-size="xs"
      onClick={() => props.onAction()}
    >
      {props.children}
    </button>
  );
}
