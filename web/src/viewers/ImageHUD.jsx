import { useEditor } from '../editor/context.jsx';

export function ImageHUD(props) {
  const actions = useEditor().actions;
  const view = () => props.document.image;
  return (
    <div
      id="imgview-hud"
      class="card absolute bottom-4 right-4 z-10 flex flex-row flex-wrap items-center gap-2 p-3 max-w-full"
    >
      <button
        id="iv-zoom-out"
        class="btn"
        data-size="xs"
        aria-label="Zoom out"
        onClick={() => props.zoom(-1)}
      >
        −
      </button>
      <button
        id="iv-zoom-label"
        class="btn"
        data-size="xs"
        onClick={() =>
          view().fit ? actions.actualImage(props.document) : actions.fitImage(props.document)
        }
      >
        {view().fit ? 'Fit' : `${Math.round(props.scale * 100)}%`}
      </button>
      <button
        id="iv-zoom-in"
        class="btn"
        data-size="xs"
        aria-label="Zoom in"
        onClick={() => props.zoom(1)}
      >
        +
      </button>
      <button
        id="iv-fit"
        class="btn"
        data-size="xs"
        aria-pressed={view().fit}
        onClick={() => actions.fitImage(props.document)}
      >
        Fit
      </button>
      <button
        id="iv-100"
        class="btn"
        data-size="xs"
        aria-pressed={!view().fit && view().scale === 1}
        onClick={() => actions.actualImage(props.document)}
      >
        1:1
      </button>
      <button
        id="iv-bg"
        class="btn"
        data-size="xs"
        onClick={() => actions.cycleImageBg(props.document)}
      >
        {view().bg[0].toUpperCase() + view().bg.slice(1)}
      </button>
      <button
        id="iv-pixel"
        class="btn"
        data-size="xs"
        aria-pressed={!!view().pixelated}
        onClick={() => actions.togglePixelated(props.document)}
      >
        {view().pixelated ? 'Pixelated' : 'Smooth'}
      </button>
      <span id="iv-meta" class="whitespace-nowrap font-mono text-muted-foreground">
        {props.document.imageMeta?.width || 0} × {props.document.imageMeta?.height || 0} px ·{' '}
        {props.document.size.toLocaleString()} bytes
      </span>
    </div>
  );
}
