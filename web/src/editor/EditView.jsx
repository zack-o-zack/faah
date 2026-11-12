import { createEffect, createMemo, createSignal, Index, on, onCleanup, onMount } from 'solid-js';
import { useEditor } from './context.jsx';
import { indentEdit } from './edit.js';
import { visibleRange, lineOffsets } from './layout.js';

export function EditView() {
  const editor = useEditor();
  const [top, setTop] = createSignal(0);
  let textarea;
  let frame = 0;
  onCleanup(() => cancelAnimationFrame(frame));
  const starts = createMemo(() => {
    editor.buffer()?.editRevision();
    return editor.buffer()?.editStarts || [0];
  });
  const offsets = createMemo(() => {
    const positions = starts();
    const text = editor.buffer()?.editContent || '';
    const columns = Int32Array.from(
      positions,
      (start, index) => (positions[index + 1] || text.length + 1) - start - 1,
    );
    return lineOffsets(columns, {
      wrap: editor.store.state.editor.wrap,
      width: editor.geometry.width - 80,
      charWidth: editor.geometry.charWidth,
      lineHeight: editor.geometry.lineHeight,
    });
  });
  const range = createMemo(() => visibleRange(offsets(), top(), editor.geometry.height));
  const slots = createMemo(() =>
    Array.from({ length: range().last - range().first }, (_, at) => range().first + at),
  );
  createEffect(
    on(
      () => [editor.active()?.path, editor.active()?.isEditing, editor.buffer()],
      () => {
        // Release the native textarea's copy when the editable buffer is discarded or closed.
        textarea.value = editor.active()?.isEditing ? editor.buffer().editContent || '' : '';
        if (!editor.active()?.isEditing) return;
        textarea.scrollTop = editor.active().editScrollTop || 0;
      },
    ),
  );
  onMount(() => {
    editor.services.edit = {
      focus: () => textarea.focus(),
      selectedText: () => textarea.value.slice(textarea.selectionStart, textarea.selectionEnd),
      center(line, start, end) {
        const index = Math.max(0, Math.min(starts().length - 1, line - 1));
        const offset = starts()[index] || 0;
        textarea.focus();
        textarea.setSelectionRange(
          typeof start === 'number' ? start : offset,
          typeof end === 'number' ? end : offset,
        );
        textarea.scrollTop = Math.max(
          0,
          offsets()[index] - textarea.clientHeight / 2 + editor.geometry.lineHeight * 2,
        );
      },
    };
    onCleanup(() => {
      delete editor.services.edit;
    });
  });
  function onInput(event) {
    const model = editor.buffer();
    model.setEditContent(event.currentTarget.value);
    editor.actions.patch({ dirty: true });
  }
  function insert(change) {
    textarea.setSelectionRange(change.start, change.end);
    window.document.execCommand('insertText', false, change.replacement);
  }
  return (
    <div
      id="editview"
      class="absolute inset-0 z-[6] flex overflow-hidden bg-background"
      hidden={!editor.active()?.isEditing}
    >
      <div
        id="editview-gutter"
        class="editview-gutter relative"
        style={{ width: `${String(starts().length).length * editor.geometry.charWidth + 26}px` }}
      >
        <div
          class="absolute left-0 w-full text-right"
          style={{ transform: `translateY(${(offsets()[range().first] || 0) - top()}px)` }}
        >
          <Index each={slots()}>
            {(index) => (
              <div style={{ height: `${offsets()[index() + 1] - offsets()[index()]}px` }}>
                {index() + 1}
              </div>
            )}
          </Index>
        </div>
      </div>
      <div class="relative h-full flex-1 overflow-hidden">
        <textarea
          id="editview-textarea"
          ref={textarea}
          aria-label="File contents"
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          onInput={onInput}
          onScroll={() => {
            if (frame) return;
            frame = requestAnimationFrame(() => {
              frame = 0;
              const scrollTop = textarea.scrollTop;
              setTop(scrollTop);
              editor.actions.patch({ editScrollTop: scrollTop });
            });
          }}
          onKeyDown={(event) => {
            const textarea = event.currentTarget;
            if (event.key === 'Escape') {
              event.preventDefault();
              void editor.actions.exitEditMode();
            }
            if (event.key === 'Tab') {
              event.preventDefault();
              insert(
                indentEdit(
                  textarea.value,
                  textarea.selectionStart,
                  textarea.selectionEnd,
                  event.shiftKey,
                ),
              );
            }
            if (event.key === 'Enter') {
              const start = textarea.value.lastIndexOf('\n', textarea.selectionStart - 1) + 1;
              const indent = textarea.value.slice(start, textarea.selectionStart).match(/^[ \t]+/);
              if (indent) {
                event.preventDefault();
                insert({
                  start: textarea.selectionStart,
                  end: textarea.selectionEnd,
                  replacement: '\n' + indent[0],
                });
              }
            }
          }}
        />
      </div>
    </div>
  );
}
