import type { JSX } from 'solid-js';

import { handleTabKeys } from './tab-keys.ts';

export function TabRail(props: {
  id?: string;
  label: string;
  size?: 'xs' | 'sm' | 'default';
  children: JSX.Element;
}): JSX.Element {
  return (
    <div id={props.id} class="tabs" data-size={props.size || 'xs'}>
      <nav
        role="tablist"
        aria-label={props.label}
        aria-orientation="horizontal"
        onKeyDown={handleTabKeys}
      >
        {props.children}
      </nav>
    </div>
  );
}
