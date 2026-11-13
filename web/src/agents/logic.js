export function groupAgentModels(harnesses = []) {
  return harnesses
    .filter((h) => h.installed)
    .map((h) => ({
      key: h.name,
      harness: h.name,
      models: (h.models || []).map((model) => ({ value: model, label: model })),
    }));
}
export function filterAgentModels(groups, query) {
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
export const targetRef = (target) =>
  target.path
    ? `${target.path}:${target.l1}${target.l2 > target.l1 ? '-' + target.l2 : ''}`
    : 'Workspace';
export const rangesOverlap = (a, b) => a.path === b.path && a.l1 <= b.l2 && b.l1 <= a.l2;
export function editRequest(session) {
  const { path, l1, l2 } = session.target;
  return { path, l1, l2, instruction: session.instruction.trim() };
}
export function agentSelection(reply) {
  return {
    harnesses: reply.harnesses || [],
    selected: reply.selected || '',
    model: reply.model || '',
    pinned: !!reply.pinned,
  };
}
