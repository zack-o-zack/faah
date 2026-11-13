import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { fitScale, imageTransform, panFrom } from './image-math.ts';
import { ImageHUD } from './ImageHUD.jsx';

export function ImageViewer(props) {
  const editor = useEditor();
  const actions = editor.actions;
  let viewport;
  let drag;
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  const [panning, setPanning] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);
  const [error, setError] = createSignal('');
  const fitted = createMemo(() =>
    fitScale(
      props.document.imageMeta?.width,
      props.document.imageMeta?.height,
      size().width,
      size().height,
    ),
  );
  const scale = () => (props.document.image.fit ? fitted() : props.document.image.scale);
  const zoom = (direction, factor) =>
    actions.zoomImage(props.document, direction, fitted(), factor);
  onMount(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(viewport);
    const wheel = (event) => {
      event.preventDefault();
      let factor = Math.abs(event.deltaY) > 50 ? 1.25 : 1.1;
      if (event.ctrlKey || event.metaKey) factor = 1.15;
      zoom(event.deltaY < 0 ? 1 : -1, factor);
    };
    const move = (event) => {
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
    viewport.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    const key = (event) => {
      const doc = props.document;
      if (event.key === '+' || event.key === '=') zoom(1);
      else if (event.key === '-' || event.key === '_') zoom(-1);
      else if (event.key === '0') actions.fitImage(doc);
      else if (event.key === '1') actions.actualImage(doc);
      else if (event.key.toLowerCase() === 'b') actions.cycleImageBg(doc);
      else if (event.key.toLowerCase() === 'p') actions.togglePixelated(doc);
      else if (event.key.startsWith('Arrow')) {
        const dx = { ArrowLeft: 40, ArrowRight: -40 }[event.key] || 0;
        const dy = { ArrowUp: 40, ArrowDown: -40 }[event.key] || 0;
        actions.updateImage(doc, {
          fit: false,
          scale: scale(),
          panX: doc.image.panX + dx,
          panY: doc.image.panY + dy,
        });
      } else return false;
      return true;
    };
    editor.services.imageKey = key;
    onCleanup(() => {
      observer.disconnect();
      viewport.removeEventListener('wheel', wheel);
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
