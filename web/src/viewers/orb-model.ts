export interface OrbModel {
  id: string | null;
  phase: 'running' | 'done' | 'failed';
  step: string;
  notes: number;
  walkthrough: boolean;
  error: string;
  reply: string;
}
export interface OrbThread {
  id: string;
  turns?: {
    tools?: string[];
    notes?: unknown[];
    walkthroughs?: unknown[];
    error?: string;
    running?: boolean;
    reply?: string;
  }[];
}
interface OrbView {
  text: string;
  shown: string;
  label: string;
  snippet: string;
  announce: string;
  busy: boolean;
}

export function orbStart(): OrbModel {
  return {
    id: null,
    phase: 'running',
    step: '',
    notes: 0,
    walkthrough: false,
    error: '',
    reply: '',
  };
}

export function orbFromThread(m: OrbModel, thread: OrbThread): OrbModel {
  const turn = thread.turns?.[thread.turns.length - 1];
  if (!turn) return { ...m, id: thread.id };
  const tools = turn.tools || [];
  let phase: OrbModel['phase'] = turn.error ? 'failed' : 'done';
  if (turn.running) phase = 'running';
  return {
    ...m,
    id: thread.id,
    phase,
    step: tools.length ? tools[tools.length - 1] || m.step : m.step,
    notes: (turn.notes || []).length,
    walkthrough: (turn.walkthroughs || []).length > 0,
    error: turn.error || '',
    reply: turn.reply || '',
  };
}

export function orbFromStep(m: OrbModel, text: string): OrbModel {
  return m.phase === 'running' ? { ...m, step: text } : m;
}

/* The list summary only says whether the last turn failed. It ends the orb
   when the thread's own events are no longer followed, for example after the
   reader opened another thread. */

export function orbFromSummary(m: OrbModel, sm: { running: boolean; failed?: boolean }): OrbModel {
  return m.phase === 'running' && !sm.running ? { ...m, phase: sm.failed ? 'failed' : 'done' } : m;
}

/* The last paragraph of the answer, as plain text: usually its conclusion. */

export function orbSnippet(reply: string): string {
  const blocks = reply
    .replace(/```[\s\S]*?```/g, '')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  const last = blocks[blocks.length - 1] || '';
  return last
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:#+|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function orbView(m: OrbModel): OrbView {
  const notes = m.notes ? m.notes + (m.notes === 1 ? ' note' : ' notes') : '';
  const walk = m.walkthrough ? 'walkthrough' : '';
  let parts = ['Explanation failed'];
  if (m.phase === 'done') parts = ['Explained', notes, walk];
  if (m.phase === 'running') parts = ['Explaining', m.step, notes, walk];
  const text = parts.filter(Boolean).join(' · ');
  const label =
    text +
    (m.phase === 'failed' && m.error ? ': ' + m.error.split('\n')[0] : '') +
    (m.id ? '. Open the explanation' : '');
  const snippet = m.phase === 'done' ? orbSnippet(m.reply) : '';
  // Beside the answer, the count is all the heading a finished orb needs.
  const shown = snippet ? [notes, walk].filter(Boolean).join(' · ') : text;
  return {
    text,
    shown,
    label,
    snippet,
    announce: m.phase === 'running' ? 'Explaining' : text,
    busy: m.phase === 'running',
  };
}
