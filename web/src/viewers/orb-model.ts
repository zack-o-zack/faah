import type { Walkthrough } from '../threads/decode.ts';

export interface OrbModel {
  id: string | null;
  turn: number | null;
  phase: 'running' | 'done' | 'failed';
  step: string;
  notes: number;
  walkthroughs: Walkthrough[];
  error: string;
  reply: string;
}
export interface OrbThread {
  id: string;
  turns?: {
    id: number;
    tools?: string[];
    notes?: unknown[];
    walkthroughs?: Walkthrough[];
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
    turn: null,
    phase: 'running',
    step: '',
    notes: 0,
    walkthroughs: [],
    error: '',
    reply: '',
  };
}

export function orbFromThread(m: OrbModel, thread: OrbThread): OrbModel {
  const turn =
    m.turn === null ? thread.turns?.at(-1) : thread.turns?.find((turn) => turn.id === m.turn);
  if (!turn) return m.turn === null ? { ...m, id: thread.id } : m;
  const tools = turn.tools || [];
  let phase: OrbModel['phase'] = turn.error ? 'failed' : 'done';
  if (turn.running) phase = 'running';
  return {
    ...m,
    id: thread.id,
    turn: turn.id,
    phase,
    step: tools.length ? tools[tools.length - 1] || m.step : m.step,
    notes: (turn.notes || []).length,
    walkthroughs: turn.walkthroughs || [],
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
  const walk = m.walkthroughs.length
    ? `${m.walkthroughs.length} walkthrough${m.walkthroughs.length === 1 ? '' : 's'}`
    : '';
  let parts = ['Explanation failed'];
  if (m.phase === 'done') parts = ['Explained', notes];
  if (m.phase === 'running') parts = ['Explaining', m.step, notes];
  const text = parts.filter(Boolean).join(' · ');
  const label =
    [text, walk].filter(Boolean).join(' · ') +
    (m.phase === 'failed' && m.error ? ': ' + m.error.split('\n')[0] : '') +
    (m.id ? '. Open the explanation' : '');
  const snippet = m.phase === 'done' ? orbSnippet(m.reply) : '';
  // Beside the answer, the count is all the heading a finished orb needs.
  const shown = snippet ? notes : text;
  return {
    text,
    shown,
    label,
    snippet,
    announce: m.phase === 'running' ? 'Explaining' : text,
    busy: m.phase === 'running',
  };
}

export interface WalkPosition {
  surface: 'review' | 'source';
  index: number;
  step: number;
}
export interface ExplanationState {
  model: OrbModel | null;
  walk: WalkPosition | null;
  compact: boolean;
}
export type WalkStep = Walkthrough['steps'][number] & { n: number; of: number };

export function orbUpdate(state: ExplanationState, model: OrbModel | null): ExplanationState {
  const same = !!model && state.model?.id === model.id && state.model.turn === model.turn;
  return { model, walk: same ? state.walk : walkStop(), compact: state.compact };
}
export function walkStart(
  model: OrbModel | null,
  index = 0,
  surface: WalkPosition['surface'] = 'source',
): WalkPosition | null {
  return model?.walkthroughs[index]?.steps.length ? { index, step: 0, surface } : null;
}
export function walkMove(
  model: OrbModel | null,
  walk: WalkPosition | null,
  delta: -1 | 1,
): WalkPosition | null {
  if (!walk) return delta === 1 ? walkStart(model) : null;
  const total = model?.walkthroughs[walk.index]?.steps.length || 0;
  return total ? { ...walk, step: Math.max(0, Math.min(total - 1, walk.step + delta)) } : null;
}
export function walkStop(): null {
  return null;
}
export function walkStep(state: ExplanationState): WalkStep | null {
  if (!state.walk) return null;
  const steps = state.model?.walkthroughs[state.walk.index]?.steps;
  const step = steps?.[state.walk.step];
  return step ? { ...step, n: state.walk.step + 1, of: steps?.length || 0 } : null;
}
