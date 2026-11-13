import { createMemo } from 'solid-js';
import { useEditor } from './context.jsx';
import { codeWidth, visualColumn } from './layout.ts';

export function Caret(props) {
  const editor = useEditor();
  const position = createMemo(() => {
    const document = editor.active();
    editor.buffer()?.revision();
    if (!document) return null;
    const geometry = editor.geometry;
    const offsets = editor.offsets();
    if (
      editor.settings.preferences().wrap &&
      offsets[document.cur] - offsets[document.cur - 1] > geometry.lineHeight
    ) {
      const measured = props.measurePosition({ line: document.cur, col: document.col || 0 });
      if (measured) return measured;
    }
    const column = visualColumn(editor.buffer().text(document.cur - 1), document.col || 0);
    const gutter = editor.settings.preferences().lineNumbers
      ? String(document.total || 1).length * geometry.charWidth + 30
      : 0;
    const capacity = Math.max(
      1,
      Math.floor(
        codeWidth(
          geometry.width,
          document.total,
          geometry.charWidth,
          editor.settings.preferences().lineNumbers,
        ) / geometry.charWidth,
      ),
    );
    const wrapped = editor.settings.preferences().wrap;
    const x = gutter + (wrapped ? column % capacity : column) * geometry.charWidth;
    const y =
      (editor.offsets()[document.cur - 1] || 0) +
      (wrapped ? Math.floor(column / capacity) : 0) * geometry.lineHeight;
    return { x, y };
  });
  return (
    <div
      id="caret"
      class="blink"
      hidden={!position()}
      style={{ transform: `translate(${position()?.x || 0}px,${position()?.y || 0}px)` }}
    />
  );
}
