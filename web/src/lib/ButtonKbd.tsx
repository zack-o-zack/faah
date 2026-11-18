import type { JSX } from 'solid-js';
import { Kbd } from './shortcuts.tsx';

export function ButtonKbd(props: { combo: string }): JSX.Element {
  return <Kbd combo={props.combo} variant="button" />;
}
