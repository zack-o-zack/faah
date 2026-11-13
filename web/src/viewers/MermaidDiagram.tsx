interface MermaidDiagramProps {
  source: string;
}
import type { JSX } from 'solid-js';
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { useTheme } from '../lib/theme-context.tsx';
import { renderDiagram } from './mermaid-runtime.ts';
import { diagramDimensions, diagramFit, diagramZoom } from './mermaid-logic.ts';
import { MermaidControls } from './MermaidControls.tsx';

export function MermaidDiagram(props: MermaidDiagramProps): JSX.Element {
  const theme = useTheme();
  const editor = useEditor();
  let viewport: HTMLDivElement | undefined;
  let output: HTMLDivElement | undefined;
  let drag: { x: number; y: number; left: number; top: number } | null = null;
  let previousMarkup: string | undefined;
  const [scale, setScale] = createSignal<number | null>(null);
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  const [panning, setPanning] = createSignal(false);
  const [fullscreen, setFullscreen] = createSignal(false);
  const [svg] = createResource(
    () => ({ source: props.source, theme: theme.current() }),
    ({ source, theme }) => renderDiagram(source, theme),
  );
  const markup = () => (svg.error ? '' : svg() || '');
  const natural = createMemo(() => diagramDimensions(markup()));
  const fitted = () => diagramFit(natural(), size(), fullscreen());
  const zoom = () => scale() ?? fitted();
  const step = (direction: number) => setScale(diagramZoom(zoom(), direction));
  function fit() {
    setScale(null);
    if (!viewport) return;
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
  }
  const toggleZoom = () => {
    if (Math.abs(zoom() - 1) < 0.05) fit();
    else setScale(1);
  };
  function toggleFullscreen() {
    if (!fullscreen()) for (const exit of editor.services.diagramFullscreens || []) exit();
    setFullscreen((value) => !value);
    fit();
  }
  createEffect(
    on(
      (): [string, number] => [markup(), zoom()],
      ([markup, scale]) => {
        if (!output) return;
        if (!markup) {
          output.replaceChildren();
          previousMarkup = undefined;
          return;
        }
        if (markup !== previousMarkup) {
          // Mermaid's strict renderer supplies SVG; adopt its parsed nodes into this owned canvas.
          const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
          output.replaceChildren(document.importNode(parsed.documentElement, true));
          previousMarkup = markup;
        }
        const svg = output.querySelector<SVGSVGElement>(':scope > svg');
        if (!svg) return;
        svg.style.width = Math.round(natural().width * scale) + 'px';
        svg.style.height = Math.round(natural().height * scale) + 'px';
        svg.style.maxWidth = 'none';
      },
    ),
  );
  onMount(() => {
    const host = viewport;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(host);
    const exit = () => {
      if (!fullscreen()) return false;
      setFullscreen(false);
      fit();
      return true;
    };
    editor.services.diagramFullscreens ||= new Set();
    editor.services.diagramFullscreens.add(exit);
    const move = (event: PointerEvent) => {
      if (!drag) return;
      host.scrollLeft = drag.left - event.clientX + drag.x;
      host.scrollTop = drag.top - event.clientY + drag.y;
    };
    const up = () => {
      drag = null;
      setPanning(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && exit()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const wheel = (event: WheelEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || !event.deltaY) return;
      event.preventDefault();
      step(event.deltaY < 0 ? 1 : -1);
    };
    host.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('keydown', key, true);
    onCleanup(() => {
      observer.disconnect();
      editor.services.diagramFullscreens?.delete(exit);
      host.removeEventListener('wheel', wheel);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', key, true);
    });
  });
  return (
    <div
      ref={viewport}
      class="md-mermaid"
      classList={{
        'is-fullscreen': fullscreen(),
        panning: panning(),
        'has-overflow':
          natural().width * zoom() > size().width - 48 ||
          natural().height * zoom() > size().height - 48,
      }}
    >
      <MermaidControls
        zoom={zoom()}
        fullscreen={fullscreen()}
        step={step}
        fit={fit}
        toggleZoom={toggleZoom}
        toggleFullscreen={toggleFullscreen}
      />
      <Show when={svg.loading}>
        <p role="status">Rendering diagram…</p>
      </Show>
      <Show when={svg.error}>
        <p role="alert">Unable to render Mermaid diagram: {svg.error?.message}</p>
        <pre>{props.source}</pre>
      </Show>
      <div
        class="md-mermaid-canvas"
        ref={output}
        role="img"
        aria-label="Mermaid diagram"
        onDblClick={toggleZoom}
        onPointerDown={(event) => {
          if (
            event.button !== 0 ||
            !viewport ||
            (viewport.scrollWidth <= viewport.clientWidth &&
              viewport.scrollHeight <= viewport.clientHeight)
          )
            return;
          event.preventDefault();
          drag = {
            x: event.clientX,
            y: event.clientY,
            left: viewport.scrollLeft,
            top: viewport.scrollTop,
          };
          setPanning(true);
        }}
      />
    </div>
  );
}
