import { Portal } from 'solid-js/web';
import { Search } from './Search.jsx';
export function SearchShell() {
  return (
    <Portal mount={document.getElementById('search-root')}>
      <Search />
    </Portal>
  );
}
