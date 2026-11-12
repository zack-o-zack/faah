// web/src/orb.js
import { $ } from './state.js';

/* The orb is the editor's sign that an explanation is running. It names the
   latest step and how many notes the agent has shown so far, then the
   outcome. It follows one explanation at a time and stays across tab
   switches. Explanations no longer open the sidebar, and notes do not show on
   the code yet, so a finished explanation stays here until the reader opens
   or dismisses it. */

/** @typedef {{id: string|null, phase: 'running'|'done'|'failed', step: string, notes: number, walkthrough: boolean, error: string, reply: string}} OrbModel */

/** @returns {OrbModel} */
export function orbStart() {
  return { id: null, phase: 'running', step: '', notes: 0, walkthrough: false, error: '', reply: '' };
}

/** Folds a full thread snapshot into the model; its last turn is the explanation's.
    @param {OrbModel} m @param {any} thread @returns {OrbModel} */
export function orbFromThread(m, thread) {
  const turn = thread.turns?.[thread.turns.length - 1];
  if (!turn) return { ...m, id: thread.id };
  const tools = turn.tools || [];
  return {
    ...m,
    id: thread.id,
    phase: turn.running ? 'running' : turn.error ? 'failed' : 'done',
    step: tools.length ? tools[tools.length - 1] : m.step,
    notes: (turn.notes || []).length,
    walkthrough: (turn.walkthroughs || []).length > 0,
    error: turn.error || '',
    reply: turn.reply || '',
  };
}

/** @param {OrbModel} m @param {string} text @returns {OrbModel} */
export function orbFromStep(m, text) {
  return m.phase === 'running' ? { ...m, step: text } : m;
}

/* The list summary only says whether the last turn failed. It ends the orb
   when the thread's own events are no longer followed, for example after the
   reader opened another thread. */
/** @param {OrbModel} m @param {{running: boolean, failed?: boolean}} sm @returns {OrbModel} */
export function orbFromSummary(m, sm) {
  return m.phase === 'running' && !sm.running ? { ...m, phase: sm.failed ? 'failed' : 'done' } : m;
}

/* The last paragraph of the answer, as plain text: usually its conclusion. */
/** @param {string} reply */
export function orbSnippet(reply) {
  const blocks = reply.replace(/```[\s\S]*?```/g, '').split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const last = blocks[blocks.length - 1] || '';
  return last
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:#+|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** What the orb shows: its text, its accessible name, and what a state change announces.
    @param {OrbModel} m */
export function orbView(m) {
  const notes = m.notes ? m.notes + (m.notes === 1 ? ' note' : ' notes') : '';
  const walk = m.walkthrough ? 'walkthrough' : '';
  const parts = m.phase === 'running' ? ['Explaining', m.step, notes, walk]
    : m.phase === 'done' ? ['Explained', notes, walk]
    : ['Explanation failed'];
  const text = parts.filter(Boolean).join(' · ');
  const label = text + (m.phase === 'failed' && m.error ? ': ' + m.error.split('\n')[0] : '') + (m.id ? '. Open the explanation' : '');
  const snippet = m.phase === 'done' ? orbSnippet(m.reply) : '';
  // Beside the answer, the count is all the heading a finished orb needs.
  const shown = snippet ? [notes, walk].filter(Boolean).join(' · ') : text;
  return { text, shown, label, snippet, announce: m.phase === 'running' ? 'Explaining' : text, busy: m.phase === 'running' };
}

/** @type {OrbModel|null} */
let model = null;
let hooks = { open: (/** @type {string} */ _id) => {}, showing: (/** @type {string|null} */ _id) => false };
/** @type {Record<string, HTMLElement>} */
const el = {};

/** @param {OrbModel|null} next */
function orbSet(next) {
  const prev = model;
  model = next;
  if (!model) { orbSync(); return; }
  const v = orbView(model);
  el.text.textContent = v.shown;
  el.snippet.textContent = v.snippet;
  el.snippet.hidden = !v.snippet;
  el.text.hidden = !v.shown;
  el.root.dataset.phase = model.phase;
  el.open.setAttribute('aria-label', v.label);
  el.open.title = v.label;
  el.spin.hidden = model.phase !== 'running';
  el.done.hidden = model.phase !== 'done';
  el.fail.hidden = model.phase !== 'failed';
  el.close.hidden = v.busy;
  if (prev?.phase !== model.phase) el.live.textContent = v.announce;
  orbSync();
}

/* Hidden while the sidebar shows the same thread, which carries the same
   progress. A finished explanation the reader has seen there is done with. */
export function orbSync() {
  if (!el.root) return;
  const shown = !!model && hooks.showing(model.id);
  if (shown && model?.phase !== 'running') model = null;
  el.root.hidden = !model || shown;
}

/** Starts following a new explanation, replacing any earlier one. */
export function orbBegin() { orbSet(orbStart()); }

/** The explanation's thread as /api/explain returned it. @param {any} thread */
export function orbAttach(thread) { if (model && !model.id) orbSet(orbFromThread(model, thread)); }

/** @param {string} message */
export function orbFailed(message) { if (model && !model.id) orbSet({ ...model, phase: 'failed', error: message }); }

/** @param {any} thread */
export function orbThread(thread) { if (model?.id === thread.id) orbSet(orbFromThread(model, thread)); }

/** @param {string} id @param {string} text */
export function orbStep(id, text) { if (model?.id === id) orbSet(orbFromStep(model, text)); }

/** @param {{id: string, running: boolean, failed?: boolean}} sm */
export function orbSummary(sm) { if (model?.id === sm.id) orbSet(orbFromSummary(model, sm)); }

/* showing(null) asks about an explanation whose thread is still being created.
   @param {{open: (id: string) => void, showing: (id: string|null) => boolean}} h */
export function initOrb(h) {
  el.root = $('#explain-orb');
  if (!el.root) return;
  hooks = h;
  el.open = $('#explain-orb-open');
  el.close = $('#explain-orb-close');
  el.live = $('#explain-orb-live');
  for (const k of ['spin', 'done', 'fail', 'text', 'snippet']) el[k] = el.root.querySelector('[data-orb=' + k + ']');
  el.open.addEventListener('click', () => {
    const id = model?.id;
    if (model?.phase !== 'running') orbSet(null);
    if (id) hooks.open(id);
  });
  el.close.addEventListener('click', () => orbSet(null));
  // The inspector and sidebar toggles flip body classes without telling threads.
  new MutationObserver(orbSync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
}
