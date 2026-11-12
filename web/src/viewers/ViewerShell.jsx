import { Match, Show, Switch } from 'solid-js';
import { Portal } from 'solid-js/web';
import { useEditor } from '../editor/context.jsx';
import { viewMode } from './view.js';
import { ImageViewer } from './ImageViewer.jsx';
import { PreviewViewer } from './PreviewViewer.jsx';
import { DiffViewer } from './DiffViewer.jsx';
import { ExplainOrb } from './ExplainOrb.jsx';

export function ViewerShell() {
  const editor = useEditor();
  return (
    <>
      <Portal mount={document.getElementById('viewers-root')}>
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
      </Portal>
      <Portal mount={document.getElementById('explanation-root')}>
        <ExplainOrb />
      </Portal>
    </>
  );
}
