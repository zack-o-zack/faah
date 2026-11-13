import type { DocTab } from '../editor/types.ts';
import type { MarkdownReply, TableReply } from './decode.ts';
interface PreviewContentProps {
  data: MarkdownReply | TableReply;
  document: DocTab;
  kind: string;
}
interface PreviewImage {
  src: string;
  path: string;
  alt: string;
}
import type { JSX } from 'solid-js';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { useEditor } from '../editor/context.tsx';
import { useTheme } from '../lib/theme-context.tsx';
import {
  brokenImageCard,
  sanitizeHTML,
  enhanceMarkdown,
  syncMarkdownPictures,
} from './markdown-dom.ts';
import { createPreviewDOM } from './preview-dom.ts';
import { MermaidDiagram } from './MermaidDiagram.tsx';
import { TableViewer } from './TableViewer.tsx';
import { Lightbox } from './Lightbox.tsx';

export function PreviewContent(props: PreviewContentProps): JSX.Element {
  const editor = useEditor();
  const theme = useTheme();
  const actions = editor.actions;
  let article: HTMLElement | undefined;
  let viewport: HTMLDivElement | undefined;
  let dom: ReturnType<typeof createPreviewDOM> | undefined;
  const [diagrams, setDiagrams] = createSignal<{ mount: HTMLDivElement; source: string }[]>([]);
  const [image, setImage] = createSignal<PreviewImage | null>(null);
  const html = createMemo(() => {
    if (props.kind !== 'markdown' || !('html' in props.data)) return '';
    return sanitizeHTML(props.data.html, props.document.path);
  });
  function jump(line: number) {
    actions.setView(props.document, 'source');
    editor.actions.patch({ cur: line });
    editor.actions.centerLine(line);
  }
  async function follow(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const copy = target.closest<HTMLElement>('[data-control~=md-copy]');
    if (copy) {
      await navigator.clipboard.writeText(
        copy.closest('.md-pre')?.querySelector('pre')?.textContent || '',
      );
      return;
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    const img = target.closest<HTMLImageElement>('img.md-zoomable');
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
      editor.actions.pushHistory(props.document.path, dom?.topLine() || 1);
      dom?.anchor(anchor);
      return;
    }
    editor.actions.pushHistory(props.document.path, dom?.topLine() || 1);
    const line = /^L(\d+)/.exec(anchor);
    await actions.openLink(path, line ? { line: +(line[1] || 1) } : {});
    const active = editor.active();
    if (active?.path === path && anchor && !line) actions.requestAnchor(active, anchor);
  }
  onMount(() => {
    const content = article;
    const host = viewport;
    if (!content || !host) return;
    if (props.kind === 'markdown') {
      enhanceMarkdown(content);
      setDiagrams(
        [...content.querySelectorAll<HTMLElement>('.md-pre[data-lang="mermaid" i]')].map((wrap) => {
          const pre = wrap.querySelector('pre');
          if (!pre) throw new Error('Diagram source is missing');
          pre.hidden = true;
          wrap.classList.add('md-mermaid-ready');
          const mount = document.createElement('div');
          wrap.append(mount);
          return { mount, source: pre.textContent || '' };
        }),
      );
    }
    dom = createPreviewDOM(host, content);
    const selection = () => {
      const selected = window.getSelection();
      if (selected?.rangeCount && !selected.isCollapsed) {
        const info = dom?.selection(selected.getRangeAt(0), props.document);
        if (info) editor.actions.setSelection(info);
      }
    };
    const service = { ...dom, jump };
    editor.services.preview = service;
    host.scrollTop = props.document.mdScroll || 0;
    if (props.document.mdAnchor) dom?.anchor(props.document.mdAnchor);
    else if (props.document.mdLine) dom?.line(props.document.mdLine);
    actions.clearPreviewTarget(props.document);
    if (editor.ui.findOpen) void editor.actions.executeFind();
    document.addEventListener('selectionchange', selection);
    // Image errors do not bubble, so the article listens in the capture phase.
    const broken = (event: Event) => {
      if (event.target instanceof HTMLImageElement)
        event.target.replaceWith(brokenImageCard(event.target));
    };
    content.addEventListener('error', broken, true);
    onCleanup(() => {
      content.removeEventListener('error', broken, true);
      document.removeEventListener('selectionchange', selection);
      if (editor.services.preview === service) delete editor.services.preview;
    });
  });
  createEffect(
    on(
      (): [string, string | undefined, number | undefined] => [
        theme.current(),
        props.document.mdAnchor,
        props.document.mdLine,
      ],
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
        onScroll={() => actions.rememberPreview(props.document, viewport?.scrollTop || 0)}
      >
        <Show
          when={props.kind === 'markdown'}
          fallback={
            <article id="md" ref={article} class="csv">
              <Show when={'rows' in props.data ? props.data : undefined}>
                {(data) => <TableViewer data={data()} document={props.document} jump={jump} />}
              </Show>
            </article>
          }
        >
          {/* eslint-disable-next-line solid/no-innerhtml, no-restricted-syntax -- Goldmark HTML passes the allowlist sanitizer. */}
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
