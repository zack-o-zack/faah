import { fireEvent, render, screen } from '@solidjs/testing-library';
import { For } from 'solid-js';
import { expect, test, vi } from 'vitest';
import { decodeServers, decodeSetup } from './decode.ts';
import { LspServerRow } from './LspServerRow.tsx';
import { SetupOptions } from './LspSetup.tsx';
import { required } from '../lib/test-values.ts';

test('server rows show ready, stopped, failed, missing and installing states with distinct actions', () => {
  const servers = decodeServers({
    servers: [
      {
        name: 'gopls',
        lang: 'Go',
        running: true,
        installed: true,
        state: 'ready',
        memBytes: 104857600,
      },
      { name: 'ts', lang: 'TypeScript and JavaScript', installed: true, state: 'off' },
      { name: 'rust', lang: 'Rust', installed: true, state: 'failed', error: 'Exited' },
      { name: 'python', lang: 'Python', autoOpt: 0 },
      { name: 'clangd', lang: 'C and C++', state: 'installing' },
    ],
  }).servers;
  const action = vi.fn();
  const view = render(() => (
    <For each={servers}>
      {(server) => <LspServerRow server={server} pending={false} onAction={action} />}
    </For>
  ));
  expect(screen.getByText('100.0 MB')).toBeTruthy();
  expect(screen.getByText('TS / JS')).toBeTruthy();
  expect(screen.getByText('C / C++')).toBeTruthy();
  expect(screen.getByText('Failed').title).toBe('Exited');
  fireEvent.click(screen.getByRole('button', { name: 'Stop gopls' }));
  fireEvent.click(screen.getByRole('button', { name: 'Start ts' }));
  fireEvent.click(screen.getByRole('button', { name: 'Restart rust' }));
  fireEvent.click(screen.getByRole('button', { name: 'Install' }));
  expect(action.mock.calls).toEqual([
    ['stop', { server: 'gopls' }],
    ['start', { server: 'ts' }],
    ['start', { server: 'rust' }],
    ['install', { server: 'python', option: 0 }],
  ]);
  expect(screen.queryByRole('button', { name: /clangd/ })).toBeNull();
  expect(screen.getByLabelText('Working')).toBeTruthy();
  expect(view.container.querySelectorAll('[data-ui="lsp-server-row"]')).toHaveLength(5);
  for (const button of screen.getAllByRole('button')) expect(button.dataset.variant).toBe('ghost');
});

test('setup shows failed startup, manual commands, unavailable tools and running installation logs', () => {
  const setup = decodeSetup({
    enabled: true,
    state: 'failed',
    server: 'ts',
    lang: 'TypeScript',
    reason: 'Exited',
    servers: [
      {
        name: 'ts',
        options: [
          { cmd: 'npm install ts', auto: true, hasTool: true },
          { cmd: 'manual setup', auto: false },
          { cmd: 'brew install ts', auto: true, hasTool: false, tool: 'brew' },
        ],
        job: { running: true, cmd: 'npm install ts', log: 'Downloading\nInstalling' },
      },
    ],
  });
  const start = vi.fn();
  render(() => <SetupOptions setup={setup} pending={false} onStart={start} onInstall={vi.fn()} />);
  expect(screen.getByText('run in a terminal')).toBeTruthy();
  expect(screen.getByText('needs brew')).toBeTruthy();
  expect(screen.getByText('Downloading Installing')).toBeTruthy();
  expect(required(screen.getByRole('button', { name: 'Install' })).hasAttribute('disabled')).toBe(
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  fireEvent.click(screen.getByRole('button', { name: 'Detect and start' }));
  expect(start).toHaveBeenCalledTimes(2);
});
