import { decodeHoldingPage } from './decode.ts';
import { render } from 'solid-js/web';
import { Holding } from './Holding.tsx';
import { ThemeProvider } from '../lib/theme-context.tsx';
const mount = document.getElementById('root');
if (!mount?.dataset.page) throw new Error('Missing holding page data');
const payload: unknown = JSON.parse(mount.dataset.page);
const data = decodeHoldingPage(payload);
render(
  () => (
    <ThemeProvider>
      <Holding data={data} />
    </ThemeProvider>
  ),
  mount,
);
