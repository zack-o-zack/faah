import type { Harness, AgentSelection } from './decode.ts';
export interface EditTarget {
  path: string;
  l1: number;
  l2: number;
}
export interface ModelGroup {
  key: string;
  harness: string;
  models: { value: string; label: string }[];
}
export function groupAgentModels(harnesses: Harness[] = []): ModelGroup[] {
  return harnesses
    .filter((h) => h.installed)
    .map((h) => ({
      key: h.name,
      harness: h.name,
      models: (h.models || []).map((model) => ({ value: model, label: model })),
    }));
}
export function filterAgentModels(groups: ModelGroup[], query: string): ModelGroup[] {
  const words = query.toLowerCase().trim().split(/\s+/);
  return groups
    .map((group) => ({
      ...group,
      models: group.models.filter((model) =>
        words.every((word) => `${group.harness} ${model.label}`.toLowerCase().includes(word)),
      ),
    }))
    .filter((group) => group.models.length);
}
export const targetRef = (target: Partial<EditTarget>): string =>
  target.path
    ? `${target.path}:${target.l1}${(target.l2 || 0) > (target.l1 || 0) ? '-' + target.l2 : ''}`
    : 'Workspace';
export const rangesOverlap = (a: EditTarget, b: EditTarget): boolean =>
  a.path === b.path && a.l1 <= b.l2 && b.l1 <= a.l2;
export function editRequest(session: {
  target: EditTarget;
  instruction: string;
}): EditTarget & { instruction: string } {
  const { path, l1, l2 } = session.target;
  return { path, l1, l2, instruction: session.instruction.trim() };
}
export function agentSelection(reply: Partial<AgentSelection>): AgentSelection {
  return {
    harnesses: reply.harnesses || [],
    selected: reply.selected || '',
    model: reply.model || '',
    pinned: !!reply.pinned,
  };
}
