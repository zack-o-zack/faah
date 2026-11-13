import type { DocTab } from '../editor/types.ts';

interface ImageViewerProps {
  document: DocTab;
}
import type { JSX } from 'solid-js';
import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { fitScale, imageTransform, panFrom } from './image-math.ts';
import { ImageHUD } from './ImageHUD.tsx';

export function ImageViewer(props: ImageViewerProps): JSX.Element {
  const editor = useEditor();
  const actions = editor.actions;
  let viewport: HTMLDivElement | undefined;
  let drag: {
    start: { x: number; y: number };
    origin: { panX: number; panY: number };
    scale: number;
  } | null = null;
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  const [panning, setPanning] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);
  const [error, setError] = createSignal('');
  const fitted = createMemo(() =>
    fitScale(
      props.document.imageMeta?.width || 0,
      props.document.imageMeta?.height || 0,
      size().width,
      size().height,
    ),
  );
  const scale = () => (props.document.image.fit ? fitted() : props.document.image.scale);
  const zoom = (direction: number, factor?: number) =>
    actions.zoomImage(props.document, direction, fitted(), factor);
  onMount(() => {
    const host = viewport;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(host);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      let factor = Math.abs(event.deltaY) > 50 ? 1.25 : 1.1;
      if (event.ctrlKey || event.metaKey) factor = 1.15;
      zoom(event.deltaY < 0 ? 1 : -1, factor);
    };
    const move = (event: PointerEvent) => {
      if (!drag) return;
      actions.updateImage(props.document, {
        fit: false,
        scale: drag.scale,
        ...panFrom(drag.origin, drag.start, { x: event.clientX, y: event.clientY }),
      });
    };
    const up = () => {
      drag = null;
      setPanning(false);
    };
    host.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    const key = (event: KeyboardEvent) => {
      const doc = props.document;
      if (event.key === '+' || event.key === '=') zoom(1);
      else if (event.key === '-' || event.key === '_') zoom(-1);
      else if (event.key === '0') actions.fitImage(doc);
      else if (event.key === '1') actions.actualImage(doc);
      else if (event.key.toLowerCase() === 'b') actions.cycleImageBg(doc);
      else if (event.key.toLowerCase() === 'p') actions.togglePixelated(doc);
      else if (event.key.startsWith('Arrow')) {
        const dx = event.key === 'ArrowLeft' ? 40 : 0;
        const horizontal = event.key === 'ArrowRight' ? -40 : dx;
        const dy = event.key === 'ArrowUp' ? 40 : 0;
        const vertical = event.key === 'ArrowDown' ? -40 : dy;
        actions.updateImage(doc, {
          fit: false,
          scale: scale(),
          panX: doc.image.panX + horizontal,
          panY: doc.image.panY + vertical,
        });
      } else return false;
      return true;
    };
    editor.services.imageKey = key;
    onCleanup(() => {
      observer.disconnect();
      host.removeEventListener('wheel', wheel);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (editor.services.imageKey === key) delete editor.services.imageKey;
    });
  });
  return (
    <div id="imgview" class="absolute inset-0 z-5 flex flex-col overflow-hidden bg-background">
      <div
        id="imgview-viewport"
        ref={viewport}
        class="relative flex flex-1 h-full w-full items-center justify-center overflow-hidden cursor-grab select-none"
        classList={{ panning: panning() }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          drag = {
            start: { x: event.clientX, y: event.clientY },
            origin: { panX: props.document.image.panX, panY: props.document.image.panY },
            scale: scale(),
          };
          setPanning(true);
        }}
      >
        <Show when={!loaded() && !error()}>
          <p role="status">Loading image…</p>
        </Show>
        <Show when={error()}>
          <p role="alert">{error()}</p>
        </Show>
        <div
          id="imgview-canvas"
          class="absolute inline-flex max-w-none max-h-none origin-center"
          classList={{
            'bg-checker': props.document.image.bg === 'checker',
            'bg-dark': props.document.image.bg === 'dark',
            'bg-light': props.document.image.bg === 'light',
          }}
          style={{ transform: imageTransform(props.document.image, fitted()) }}
        >
          <img
            id="imgview-img"
            src={`api/raw?path=${encodeURIComponent(props.document.path)}&ref=${encodeURIComponent(props.document.diffRef || '')}&v=${props.document.viewerRevision || 0}`}
            alt={props.document.name}
            class="block pointer-events-none max-w-none max-h-none"
            classList={{ 'render-pixelated': !!props.document.image.pixelated }}
            onLoad={(event) => {
              actions.imageLoaded(
                props.document,
                event.currentTarget.naturalWidth,
                event.currentTarget.naturalHeight,
              );
              setLoaded(true);
            }}
            onError={() => setError('Unable to load image')}
          />
        </div>
      </div>
      <ImageHUD document={props.document} scale={scale()} zoom={zoom} />
    </div>
  );
}
