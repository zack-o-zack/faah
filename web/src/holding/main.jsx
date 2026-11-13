import { render } from 'solid-js/web';
import { Holding } from './Holding.jsx';
import { ThemeProvider } from '../lib/theme-context.tsx';
const mount = document.getElementById('root');
render(
  () => (
    <ThemeProvider>
      <Holding data={JSON.parse(mount.dataset.page)} />
    </ThemeProvider>
  ),
  mount,
);
