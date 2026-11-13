export function positionNow(document, navigation, word) {
  if (!document) return null;
  if (navigation.at?.word && navigation.at.path === document.path) return navigation.at;
  return word ? { word, path: document.path, line: document.cur, col: 0, imprecise: true } : null;
}
export const canAskServer = (at, state) =>
  !!at && !at.imprecise && ['ready', 'indexing'].includes(state);
export function callTarget(node, direction) {
  return direction === 'in' && node.sites?.length
    ? { path: node.sitePath, line: node.sites[0] }
    : { path: node.path, line: node.line };
}
export function callIdentity(node) {
  return `${node.path}:${node.line}:${node.name}`;
}
export function isCallCycle(node, ancestors) {
  return ancestors.includes(callIdentity(node));
}
export function shortKind(kind = 'sym') {
  return (
    {
      func: 'fn',
      method: 'fn',
      class: 'cls',
      struct: 'str',
      interface: 'int',
      type: 'typ',
      const: 'cst',
      module: 'mod',
      heading: 'h',
    }[kind] || kind.slice(0, 3)
  );
}
export const installLog = (job) => (job?.log || '').trimEnd().split('\n').slice(-12).join('\n');
