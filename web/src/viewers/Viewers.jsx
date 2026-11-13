import { Match, Show, Switch } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { viewMode } from './view.ts';
import { ImageViewer } from './ImageViewer.jsx';
import { PreviewViewer } from './PreviewViewer.jsx';
import { DiffViewer } from './DiffViewer.jsx';

/** The views that cover the source for an image, a previewed file or a diff. */
export function Viewers() {
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
