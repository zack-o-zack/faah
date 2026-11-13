import { Portal } from 'solid-js/web';
import { GitPanel } from './GitPanel.jsx';
import { Unpushed } from './Unpushed.jsx';
export function GitShell() {
  return (
    <Portal mount={document.getElementById('git-root')}>
      <Unpushed />
      <GitPanel />
    </Portal>
  );
}
