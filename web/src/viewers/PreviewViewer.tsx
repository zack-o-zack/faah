import type { JSX } from 'solid-js';
import type { DocTab } from '../editor/types.ts';
import { decodeMarkdown, decodeTable } from './decode.ts';
interface PreviewViewerProps {
  document: DocTab;
  kind: string;
}
import { Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { createViewerResource } from './resource.ts';
import { PreviewContent } from './PreviewContent.tsx';
export function PreviewViewer(props: PreviewViewerProps): JSX.Element {
  const editor = useEditor();
  const [data, { refetch }] = createViewerResource(
    editor,
    () => props.document,
    () => (props.kind === 'table' ? 'api/table' : 'api/markdown'),
    (value) => (props.kind === 'table' ? decodeTable(value) : decodeMarkdown(value)),
  );
  return (
    <Show
      when={!data.loading}
      fallback={
        <div id="mdview" class="absolute inset-0 bg-background p-4" role="status">
          Loading preview…
        </div>
      }
    >
      <Show
        when={!data.error}
        fallback={
          <div id="mdview" class="absolute inset-0 bg-background p-4" role="alert">
            Unable to load preview: {data.error?.message} <button onClick={refetch}>Retry</button>
            <button onClick={() => editor.actions.setView(props.document, 'source')}>
              Open Source
            </button>
          </div>
        }
      >
        <Show when={data()} keyed>
          {(data) => <PreviewContent data={data} document={props.document} kind={props.kind} />}
        </Show>
      </Show>
    </Show>
  );
}
