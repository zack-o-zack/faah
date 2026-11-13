import { render } from 'solid-js/web';
import { ThemeProvider } from '../lib/theme-context.tsx';
import { Toaster } from '../lib/toast.tsx';
import { WorkbenchProvider } from './context.tsx';
import { Workbench } from './Workbench.tsx';
const mount = document.getElementById('root');
if (!mount) throw new Error('Missing root mount point');
render(
  () => (
    <ThemeProvider>
      <WorkbenchProvider>
        <Workbench />
        <Toaster />
      </WorkbenchProvider>
    </ThemeProvider>
  ),
  mount,
);
