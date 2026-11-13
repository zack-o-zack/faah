import type { JSX } from 'solid-js';
import { AgentPicker } from '../agents/AgentPicker.tsx';
export function AgentChoice(): JSX.Element {
  return <AgentPicker id="git-agent" compact />;
}
