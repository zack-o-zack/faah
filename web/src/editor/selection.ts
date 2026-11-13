export interface SelectionInfo {
  path: string;
  text: string;
  l1: number;
  l2: number;
  c1?: number;
  c2?: number;
  all?: boolean;
  isEditor?: boolean;
  isMarkdownPreview?: boolean;
  rawMarkdown?: string;
  html?: string;
}
export const SEL_KEYS: Record<string, string> = {
  KeyC: 'copy-ref',
  KeyA: 'copy-agent',
  KeyU: 'usages',
  KeyE: 'agent-edit',
  KeyR: 'review-comment',
  KeyT: 'thread',
  KeyX: 'explain',
  KeyM: 'copy-markdown',
  KeyS: 'copy-source',
};
export const SEL_MENU_ITEMS = [
  { sel: 'thread', label: 'Start Agent Thread', keys: 'Alt+T' },
  { sel: 'explain', label: 'Explain', keys: 'Alt+X', forCode: true },
  { sel: 'agent-edit', label: 'Edit Inline', keys: 'Alt+E' },
  { sel: 'copy-source', label: 'Copy Source', keys: 'Mod+C', forCode: true },
  { sel: 'copy-preview-text', label: 'Copy Formatted Text', keys: 'Mod+C', forPreview: true },
  { sel: 'copy-markdown', label: 'Copy Raw Markdown', keys: 'Alt+M', forPreview: true },
  { sel: 'copy-ref', label: 'Copy Ref', keys: 'Alt+C' },
  { sel: 'copy-agent', label: 'Copy with Context', keys: 'Alt+A' },
  { sel: 'review-comment', label: 'Add Review Comment', keys: 'Alt+R' },
  { sel: 'usages', label: 'Find Usages', keys: 'Alt+U', forCode: true },
];
export function selectionRef(info: SelectionInfo): string {
  return info.l1 === info.l2 ? `${info.path}:${info.l1}` : `${info.path}:${info.l1}-${info.l2}`;
}
export function contextSnippet(info: SelectionInfo): string {
  const lines = info.l1 === info.l2 ? `line ${info.l1}` : `lines ${info.l1}-${info.l2}`;
  return `@${info.path} ${lines}\n\`\`\`${info.path.split('.').pop() || ''}\n${info.text}\n\`\`\``;
}
