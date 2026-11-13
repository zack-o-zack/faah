interface MermaidControlsProps {
  zoom: number;
  fullscreen: boolean;
  step: (direction: number) => void;
  fit: () => void;
  toggleZoom: () => void;
  toggleFullscreen: () => void;
}
import type { JSX } from 'solid-js';
export function MermaidControls(props: MermaidControlsProps): JSX.Element {
  return (
    <>
      <div class="md-mermaid-controls" role="group" aria-label="Diagram zoom controls">
        <DiagramButton
          label="Zoom out diagram (or Ctrl+Scroll)"
          icon="icon-[lucide--minus]"
          disabled={props.zoom <= 0.25}
          onClick={() => props.step(-1)}
        />
        <button
          type="button"
          class="btn"
          data-control="md-mermaid-zoom md-mermaid-zoom-label"
          data-variant="ghost"
          data-size="xs"
          aria-label="Toggle zoom"
          title="Click to toggle 100% / Fit"
          onClick={() => props.toggleZoom()}
        >
          {Math.round(props.zoom * 100)}%
        </button>
        <DiagramButton
          label="Zoom in diagram (or Ctrl+Scroll)"
          icon="icon-[lucide--plus]"
          disabled={props.zoom >= 4}
          onClick={() => props.step(1)}
        />
        <DiagramButton
          label="Fit diagram to view"
          icon="icon-[lucide--scan]"
          onClick={() => props.fit()}
        />
        <DiagramButton
          label={props.fullscreen ? 'Exit full screen (Esc)' : 'Full screen'}
          icon={props.fullscreen ? 'icon-[lucide--minimize-2]' : 'icon-[lucide--maximize-2]'}
          onClick={() => props.toggleFullscreen()}
        />
        <DiagramButton
          label="Close full screen (Esc)"
          icon="icon-[lucide--x]"
          class="btn md-mermaid-fs-only"
          onClick={() => props.toggleFullscreen()}
        />
      </div>
      <button
        type="button"
        class="btn hidden [.is-fullscreen_&]:inline-flex fixed top-3 right-3 z-[1001]"
        data-control="md-mermaid-fs-close"
        data-variant="ghost"
        data-size="icon-xs"
        title="Close full screen (Esc)"
        aria-label="Close full screen"
        onClick={() => props.toggleFullscreen()}
      >
        <span class="icon-[lucide--x] size-3.5 shrink-0" aria-hidden="true" />
      </button>
    </>
  );
}
function DiagramButton(props: {
  label: string;
  icon: string;
  class?: string;
  disabled?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      class={props.class || 'btn'}
      data-control="md-mermaid-zoom"
      data-variant="ghost"
      data-size="icon-xs"
      title={props.label}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={() => props.onClick()}
    >
      <span class={`${props.icon} size-3.5`} aria-hidden="true" />
    </button>
  );
}
