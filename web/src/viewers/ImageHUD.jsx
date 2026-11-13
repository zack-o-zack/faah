import { useEditor } from '../editor/context.jsx';
import { fmtBytes } from '../status/logic.ts';

export function ImageHUD(props) {
  const actions = useEditor().actions;
  const view = () => props.document.image;
  return (
    <div
      id="imgview-hud"
      class="card absolute bottom-4 right-4 z-10 flex flex-row flex-wrap items-center gap-2 p-3 max-w-full"
    >
      <div data-ui="imgview-hud-group" class="flex items-center gap-2">
        <button
          id="iv-zoom-out"
          class="btn"
          data-size="xs"
          aria-label="Zoom out"
          onClick={() => props.zoom(-1)}
          data-variant="ghost"
          data-control="iv-btn"
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
          data-variant="ghost"
          data-control="iv-btn iv-btn-text"
        >
          {view().fit
            ? `Fit (${Math.round(props.scale * 100)}%)`
            : `${Math.round(props.scale * 100)}%`}
        </button>
        <button
          id="iv-zoom-in"
          class="btn"
          data-size="xs"
          aria-label="Zoom in"
          onClick={() => props.zoom(1)}
          data-variant="ghost"
          data-control="iv-btn"
        >
          +
        </button>
      </div>
      <span data-ui="iv-sep" class="" />
      <div data-ui="imgview-hud-group" class="flex items-center gap-2">
        <button
          id="iv-fit"
          class="btn"
          data-size="xs"
          aria-pressed={view().fit}
          onClick={() => actions.fitImage(props.document)}
          data-variant="ghost"
          data-control="iv-btn"
        >
          Fit
        </button>
        <button
          id="iv-100"
          class="btn"
          data-size="xs"
          aria-pressed={!view().fit && view().scale === 1}
          onClick={() => actions.actualImage(props.document)}
          data-variant="ghost"
          data-control="iv-btn"
        >
          1:1
        </button>
      </div>
      <span data-ui="iv-sep" class="" />
      <div data-ui="imgview-hud-group" class="flex items-center gap-2">
        <button
          id="iv-bg"
          class="btn"
          data-size="xs"
          onClick={() => actions.cycleImageBg(props.document)}
          data-variant="ghost"
          data-control="iv-btn"
        >
          {view().bg[0].toUpperCase() + view().bg.slice(1)}
        </button>
        <button
          id="iv-pixel"
          class="btn"
          data-size="xs"
          aria-pressed={!!view().pixelated}
          onClick={() => actions.togglePixelated(props.document)}
          data-variant="ghost"
          data-control="iv-btn"
        >
          {view().pixelated ? 'Pixelated' : 'Smooth'}
        </button>
      </div>
      <span data-ui="iv-sep" class="" />
      <span id="iv-meta" class="whitespace-nowrap font-mono text-muted-foreground">
        {props.document.imageMeta?.width || 0} × {props.document.imageMeta?.height || 0} px ·{' '}
        {fmtBytes(props.document.size)}
      </span>
    </div>
  );
}
