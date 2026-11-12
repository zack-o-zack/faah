import { Show } from 'solid-js';

export function MermaidControls(props) {
  return (
    <div
      class="md-mermaid-controls flex items-center gap-1"
      role="group"
      aria-label="Diagram zoom controls"
    >
      <button
        class="btn"
        data-size="xs"
        aria-label="Zoom out diagram"
        disabled={props.zoom <= 0.25}
        onClick={() => props.step(-1)}
      >
        −
      </button>
      <button
        class="btn"
        data-size="xs"
        aria-label="Toggle diagram zoom"
        title="Toggle 100% / Fit"
        onClick={() => props.toggleZoom()}
      >
        {Math.round(props.zoom * 100)}%
      </button>
      <button
        class="btn"
        data-size="xs"
        aria-label="Zoom in diagram"
        disabled={props.zoom >= 4}
        onClick={() => props.step(1)}
      >
        +
      </button>
      <button
        class="btn"
        data-size="xs"
        aria-label="Fit diagram to view"
        onClick={() => props.fit()}
      >
        Fit
      </button>
      <button
        class="btn"
        data-size="xs"
        aria-label="Toggle diagram fullscreen"
        onClick={() => props.toggleFullscreen()}
      >
        {props.fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
      </button>
      <Show when={props.fullscreen}>
        <button
          class="btn"
          data-size="xs"
          aria-label="Close diagram fullscreen"
          onClick={() => props.toggleFullscreen()}
        >
          Close
        </button>
      </Show>
    </div>
  );
}
