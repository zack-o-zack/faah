import type { JSX } from 'solid-js';
import type { SetupReply } from './decode.ts';
import { For, Match, Show, Switch } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { LspInstaller } from './LspInstaller.tsx';
export function LspSetup(): JSX.Element {
  const editor = useEditor();
  const language = editor.language;
  const extension = () => editor.active()?.path.match(/\.[^./]+$/)?.[0] || editor.active()?.name;
  return (
    <>
      <Switch>
        <Match when={language.setup.error}>
          <div data-ui="hint" class="empty text-muted-foreground" role="alert">
            Could not check language servers: {language.setup.error.message}
          </div>
        </Match>
        <Match when={language.setup()}>
          {(setup) => (
            <Switch>
              <Match when={!setup().enabled}>
                <div data-ui="hint" class="empty text-muted-foreground">
                  Language servers are turned off: faah was started with <b>-no-lsp</b>. Restart it
                  without that flag for call trails, hover and precise references.
                </div>
              </Match>
              <Match when={!setup().servers.length}>
                <div data-ui="hint" class="empty text-muted-foreground">
                  faah knows no language server for <b>{extension()}</b> files, so call trails are
                  not available here.
                </div>
              </Match>
              <Match when={setup().servers.length}>
                <SetupOptions
                  setup={setup()}
                  pending={!!language.state.pending}
                  onStart={() =>
                    void editor.actions.runLspAction('start', { path: editor.active()?.path })
                  }
                  onInstall={(server, option) =>
                    void editor.actions.runLspAction('install', { server, option })
                  }
                />
              </Match>
            </Switch>
          )}
        </Match>
      </Switch>
      <Show when={language.state.error}>
        <p role="alert">{language.state.error}</p>
      </Show>
    </>
  );
}
interface SetupOptionsProps {
  setup: SetupReply;
  pending: boolean;
  onStart: () => void;
  onInstall: (server: string, option: number) => void;
}
export function SetupOptions(props: SetupOptionsProps): JSX.Element {
  const offers = () => props.setup.servers.filter((server) => server.options.length || server.job);
  const running = () => props.pending || props.setup.servers.some((server) => server.job?.running);
  return (
    <div data-ui="lsp-setup" class="flex flex-col gap-2 p-3 text-muted-foreground">
      <Show
        when={props.setup.state === 'failed'}
        fallback={
          <p>
            Call trails, hover and precise references for {props.setup.lang} need a language server,
            and none is installed.
          </p>
        }
      >
        <p>
          <b>{props.setup.server}</b> did not start:{' '}
          <span data-ui="lsp-reason" class="text-destructive">
            {props.setup.reason || 'unknown error'}
          </span>
        </p>
        <div data-ui="lsp-row" class="flex items-center flex-wrap gap-2">
          <StartButton
            title="Retry starting language server"
            pending={props.pending}
            onStart={props.onStart}
          >
            Retry
          </StartButton>
        </div>
        <Show when={offers().length}>
          <p>If it is broken or incomplete, install it again:</p>
        </Show>
      </Show>
      <For each={offers()}>
        {(server) => (
          <LspInstaller server={server} disabled={running()} onInstall={props.onInstall} />
        )}
      </For>
      <Show when={!offers().length}>
        <p>
          faah has no installer for this one. Install{' '}
          <For each={props.setup.servers}>
            {(server, index) => (
              <>
                {index() ? ' or ' : ''}
                <b>{server.name}</b>
              </>
            )}
          </For>{' '}
          and make sure it is on PATH.
        </p>
      </Show>
      <div data-ui="lsp-row" class="flex items-center flex-wrap gap-2">
        <span>Installed one yourself?</span>
        <StartButton
          title="Detect and start language server"
          pending={props.pending}
          onStart={props.onStart}
        >
          Detect and start
        </StartButton>
      </div>
    </div>
  );
}

function StartButton(props: {
  title: string;
  pending: boolean;
  onStart: () => void;
  children: JSX.Element;
}): JSX.Element {
  return (
    <button
      class="btn"
      data-start
      data-control="lsp-btn"
      data-variant="outline"
      data-size="xs"
      title={props.title}
      disabled={props.pending}
      onClick={() => props.onStart()}
    >
      {props.children}
    </button>
  );
}
