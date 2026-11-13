import type { JSX } from 'solid-js';
import { Match, Show, Switch } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { viewMode } from './view.ts';
import { ImageViewer } from './ImageViewer.tsx';
import { PreviewViewer } from './PreviewViewer.tsx';
import { DiffViewer } from './DiffViewer.tsx';

/** The views that cover the source for an image, a previewed file or a diff. */
export function Viewers(): JSX.Element {
  const editor = useEditor();
  return (
    <>
      <Show when={editor.active()} keyed>
        {(document) => (
          <Switch>
            <Match when={viewMode(document) === 'image'}>
              <ImageViewer document={document} />
            </Match>
            <Match when={viewMode(document) === 'markdown' || viewMode(document) === 'table'}>
              <PreviewViewer document={document} kind={viewMode(document)} />
            </Match>
          </Switch>
        )}
      </Show>
      <DiffViewer />
    </>
  );
}
