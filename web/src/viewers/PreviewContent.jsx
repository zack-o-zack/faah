import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { useEditor } from '../editor/context.jsx';
import { useTheme } from '../lib/theme-context.jsx';
import { sanitizeHTML, enhanceMarkdown, syncMarkdownPictures } from './markdown-dom.js';
import { createPreviewDOM } from './preview-dom.js';
import { MermaidDiagram } from './MermaidDiagram.jsx';
import { TableViewer } from './TableViewer.jsx';
import { Lightbox } from './Lightbox.jsx';

export function PreviewContent(props) {
  const editor = useEditor();
  const theme = useTheme();
  const actions = editor.store.viewerActions;
  let article;
  let viewport;
  let dom;
  const [diagrams, setDiagrams] = createSignal([]);
  const [image, setImage] = createSignal(null);
  const html = () => {
    if (props.kind !== 'markdown') return '';
    return sanitizeHTML(props.data.html, props.document.path);
  };
  function jump(line) {
    actions.setView(props.document, 'source');
    editor.actions.patch({ cur: line });
    editor.actions.centerLine(line);
  }
  async function follow(event) {
    const target = event.target;
    const copy = target.closest('[data-control~=md-copy]');
    if (copy) {
      await navigator.clipboard.writeText(copy.closest('.md-pre').querySelector('pre').textContent);
      return;
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    const img = target.closest('img.md-zoomable');
    if (img) {
      setImage({
        src: img.currentSrc || img.src,
        path: img.dataset.picturePath || img.dataset.rawPath || '',
        alt: img.alt,
      });
      return;
    }
    const link = target.closest('a');
    if (!link || (!link.dataset.path && link.dataset.anchor === undefined)) return;
    event.preventDefault();
    const path = link.dataset.path;
    const anchor = link.dataset.anchor || '';
    if (!path || path === props.document.path) {
      editor.store.actions.pushHistory(props.document.path, dom.topLine());
      dom.anchor(anchor);
      return;
    }
    editor.store.actions.pushHistory(props.document.path, dom.topLine());
    const line = /^L(\d+)/.exec(anchor);
    if (await editor.services.followDirectory?.(path)) return;
    await editor.actions.openFile(path, line ? { line: +line[1] } : {});
    if (editor.active()?.path === path && anchor && !line)
      actions.requestAnchor(editor.active(), anchor);
  }
  onMount(() => {
    if (props.kind === 'markdown') {
      enhanceMarkdown(article);
      setDiagrams(
        [...article.querySelectorAll('.md-pre[data-lang="mermaid" i]')].map((wrap) => {
          const pre = wrap.querySelector('pre');
          pre.hidden = true;
          wrap.classList.add('md-mermaid-ready');
          const mount = document.createElement('div');
          wrap.append(mount);
          return { mount, source: pre.textContent };
        }),
      );
    }
    dom = createPreviewDOM(viewport, article);
    const selection = () => {
      const selected = window.getSelection();
      if (selected?.rangeCount && !selected.isCollapsed) {
        const info = dom.selection(selected.getRangeAt(0), props.document);
        if (info) editor.actions.setSelection(info);
      }
    };
    const service = { ...dom, jump };
    editor.services.preview = service;
    viewport.scrollTop = props.document.mdScroll || 0;
    if (props.document.mdAnchor) dom.anchor(props.document.mdAnchor);
    else if (props.document.mdLine) dom.line(props.document.mdLine);
    actions.clearPreviewTarget(props.document);
    if (editor.ui.findOpen) void editor.actions.executeFind();
    document.addEventListener('selectionchange', selection);
    onCleanup(() => {
      document.removeEventListener('selectionchange', selection);
      if (editor.services.preview === service) delete editor.services.preview;
    });
  });
  createEffect(
    on(
      () => [theme.current(), props.document.mdAnchor, props.document.mdLine],
      ([, anchor, line]) => {
        if (!article) return;
        syncMarkdownPictures(
          article,
          getComputedStyle(document.documentElement).colorScheme === 'dark' ? 'dark' : 'light',
        );
        if (anchor) dom?.anchor(anchor);
        else if (line) dom?.line(line);
      },
    ),
  );
  return (
    <>
      <div
        id="mdview"
        ref={viewport}
        class="absolute inset-0 overflow-auto bg-background"
        onClick={follow}
        onScroll={() => actions.rememberPreview(props.document, viewport.scrollTop)}
      >
        <Show
          when={props.kind === 'markdown'}
          fallback={
            <article id="md" ref={article} class="csv">
              <TableViewer data={props.data} document={props.document} jump={jump} />
            </article>
          }
        >
          {/* Goldmark HTML is allowlist-sanitized before it enters the preview. */}
          {/* eslint-disable-next-line solid/no-innerhtml -- Goldmark HTML passes the allowlist sanitizer. */}
          <article id="md" ref={article} class="md" innerHTML={html()} />
        </Show>
      </div>
      <For each={diagrams()}>
        {(diagram) => (
          <Portal mount={diagram.mount}>
            <MermaidDiagram source={diagram.source} />
          </Portal>
        )}
      </For>
      <Show when={image()}>
        {(current) => <Lightbox image={current()} close={() => setImage(null)} />}
      </Show>
    </>
  );
}
