import { createSignal } from 'solid-js';
import { textOffsets } from './edit.js';
import { api } from '../lib/api.js';
import { CHUNK, htmlTextLen, lineText, lineOffsets } from './layout.js';

/** Large arrays live here, outside the metadata store's deep proxy. */
export function createDocumentBuffer(
  path,
  { fetcher = api, ref = '', onMetadata = () => {} } = {},
) {
  const [revision, setRevision] = createSignal(0);
  const [editRevision, editChanged] = createSignal(0);
  let editContent = null;
  let editStarts = [0];
  const lines = [];
  const chunks = new Set();
  const pending = new Map();
  const refining = new Map();
  let columns = new Int32Array(0);
  let generation = 0;
  let disposed = false;
  let layoutKey = '';
  let measureKey = '';
  let wrapping = false;
  const heights = new Map();
  let offsets = new Float64Array(1);
  const changed = () => {
    layoutKey = '';
    setRevision((value) => value + 1);
  };
  function apply(result) {
    if ((result.total || 0) !== lines.length) {
      lines.length = result.total || 0;
      columns = new Int32Array(result.total || 0);
      columns.fill(-1);
    }
    const start = result.start || 0;
    for (let index = 0; index < (result.lines || []).length; index++) {
      const at = start + index;
      lines[at] = result.lines[index];
      columns[at] = htmlTextLen(result.lines[index]);
      heights.delete(at);
    }
    chunks.add(Math.floor(start / CHUNK));
    onMetadata(result);
    changed();
  }
  function cancel() {
    generation++;
    for (const request of pending.values()) request.controller.abort();
    for (const timer of refining.values()) clearTimeout(timer);
    pending.clear();
    refining.clear();
  }
  async function loadChunk(chunk, { force = false, refine = false, onlyIfChanged = false } = {}) {
    if (disposed || (!force && chunks.has(chunk))) return;
    if (pending.has(chunk)) return pending.get(chunk).promise;
    const controller = new AbortController();
    const mine = generation;
    const request = { controller, promise: null };
    const load = async () => {
      try {
        const result = await fetcher(
          'api/file',
          { path, start: chunk * CHUNK, count: CHUNK, ref },
          { signal: controller.signal },
        );
        if (disposed || mine !== generation) return;
        if (onlyIfChanged) {
          const same =
            result.total === lines.length &&
            (result.lines || []).every(
              (line, index) => lines[(result.start || 0) + index] === line,
            );
          if (same) {
            onMetadata(result);
            return { ...result, unchanged: true };
          }
          // Invalidate other windows only after a changed response is ready to publish.
          cancel();
          chunks.clear();
          heights.clear();
          lines.fill(undefined);
          columns.fill(-1);
        }
        apply(result);
        if (result.refine && !refine) scheduleRefine(chunk);
        return result;
      } finally {
        if (pending.get(chunk) === request) pending.delete(chunk);
      }
    };
    pending.set(chunk, request);
    request.promise = load();
    return request.promise;
  }
  function scheduleRefine(chunk, tries = 0) {
    if (disposed || refining.has(chunk) || tries > 6) return;
    const mine = generation;
    const timer = setTimeout(
      async () => {
        refining.delete(chunk);
        if (disposed || mine !== generation) return;
        try {
          const result = await loadChunk(chunk, { force: true, refine: true });
          if (result && !result.exact) scheduleRefine(chunk, tries + 1);
        } catch {
          // A later visible-window request can retry a failed refinement.
        }
      },
      Math.min(800 * 1.6 ** tries, 5000),
    );
    refining.set(chunk, timer);
  }
  return {
    lines,
    editRevision,
    get editContent() {
      return editContent;
    },
    get editStarts() {
      return editStarts;
    },
    setEditContent(content) {
      editContent = content;
      editStarts = content == null ? [0] : textOffsets(content);
      editChanged((value) => value + 1);
    },
    chunks,
    pending,
    refining,
    revision,
    get columns() {
      return columns;
    },
    get generation() {
      return generation;
    },
    text: (index) => lineText(lines[index]),
    apply,
    loadChunk,
    refine: scheduleRefine,
    ensure(first, last) {
      const work = [];
      for (
        let chunk = Math.floor(first / CHUNK);
        chunk <= Math.floor(Math.max(first, last - 1) / CHUNK);
        chunk++
      ) {
        work.push(loadChunk(chunk));
      }
      return Promise.all(work);
    },
    measureHeights(entries) {
      if (!wrapping) return;
      let dirty = false;
      for (const [index, height] of entries) {
        if (index < 0 || index >= lines.length || height <= 0) continue;
        if (Math.abs(height - (offsets[index + 1] - offsets[index])) < 0.5) continue;
        heights.set(index, height);
        dirty = true;
      }
      if (dirty) changed();
    },
    layout(options) {
      const key = JSON.stringify(options);
      wrapping = options.wrap;
      if (measureKey !== key) {
        heights.clear();
        measureKey = key;
      }
      if (layoutKey !== key) {
        offsets = lineOffsets(columns, { ...options, heights });
        layoutKey = key;
      }
      return offsets;
    },
    reset() {
      cancel();
      chunks.clear();
      heights.clear();
      lines.fill(undefined);
      columns.fill(-1);
      changed();
    },
    dispose() {
      disposed = true;
      editContent = null;
      editStarts = [0];
      heights.clear();
      cancel();
      lines.length = 0;
      columns = new Int32Array(0);
      chunks.clear();
      offsets = new Float64Array(1);
    },
  };
}
