import { Popover } from './Popover.jsx';

export function DropdownMenu(props) {
  return (
    <Popover label={props.label} role="menu" onOpen={props.onOpen} onClose={props.onClose}>
      {props.children}
    </Popover>
  );
}
