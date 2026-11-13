import { createEffect, onCleanup, onMount, type Component } from 'solid-js';

export interface EditorGeometry {
  lineHeight: number;
  charWidth: number;
}

interface EditorMeasureProps {
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  onMeasure: (geometry: EditorGeometry) => void;
}

const SAMPLE = 'x'.repeat(100);

/** Measures the editor font's character width whenever the type settings or loaded fonts change. */
export const EditorMeasure: Component<EditorMeasureProps> = (props) => {
  let sample: HTMLSpanElement | undefined;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  function measure(): void {
    if (!sample || disposed) return;
    const width = sample.getBoundingClientRect().width / SAMPLE.length;
    props.onMeasure({ lineHeight: props.lineHeight, charWidth: width || 7.8 });
  }
  createEffect(() => {
    void props.fontSize;
    void props.fontFamily;
    void props.lineHeight;
    measure();
  });
  // Web fonts swap in after first paint and change the width.
  onMount(() => void document.fonts?.ready.then(measure));
  return (
    <span
      ref={sample}
      aria-hidden="true"
      class="invisible absolute -top-[999px] whitespace-pre"
      style={{
        'font-size': `${props.fontSize}px`,
        'line-height': `${props.lineHeight}px`,
        'font-family': props.fontFamily || 'var(--mono)',
      }}
    >
      {SAMPLE}
    </span>
  );
};
