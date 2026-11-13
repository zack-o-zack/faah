import { render } from 'solid-js/web';
import { ThemeProvider } from '../lib/theme-context.tsx';
import { Toaster } from '../lib/toast.tsx';
import { WorkbenchProvider } from './context.jsx';
import { Workbench } from './Workbench.jsx';
render(
  () => (
    <ThemeProvider>
      <WorkbenchProvider>
        <Workbench />
        <Toaster />
      </WorkbenchProvider>
    </ThemeProvider>
  ),
  document.getElementById('root'),
);
