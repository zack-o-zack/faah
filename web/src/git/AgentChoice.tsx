import type { JSX } from 'solid-js';
import { AgentPicker } from '../agents/AgentPicker.jsx';
export function AgentChoice(): JSX.Element {
  return <AgentPicker id="git-agent" compact />;
}
