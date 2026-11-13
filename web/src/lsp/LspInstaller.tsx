import type { JSX } from 'solid-js';
import type { SetupReply, InstallJob } from './decode.ts';
import { For, Match, Show, Switch } from 'solid-js';
import { copyText } from '../lib/clipboard.ts';
import { installLog } from './logic.ts';
interface LspInstallerProps {
  server: SetupReply['servers'][number];
  disabled: boolean;
  onInstall: (name: string, option: number) => void;
}
export function LspInstaller(props: LspInstallerProps): JSX.Element {
  return (
    <div data-ui="lsp-server" class="card overflow-hidden">
      <div data-ui="lsp-name" class="p-3 font-mono">
        {props.server.name}
      </div>
      <For each={props.server.options}>
        {(option, index) => (
          <div data-ui="lsp-opt" class="flex items-center gap-2 p-3">
            <code>{option.cmd}</code>
            <span data-ui="lsp-acts" class="flex items-center flex-none gap-2">
              <Switch>
                <Match when={!option.auto}>
                  <span data-ui="lsp-need" class="whitespace-nowrap text-muted-foreground">
                    run in a terminal
                  </span>
                </Match>
                <Match when={!option.hasTool}>
                  <span data-ui="lsp-need" class="whitespace-nowrap text-muted-foreground">
                    needs {option.tool}
                  </span>
                </Match>
                <Match when={option.auto && option.hasTool}>
                  <button
                    class="btn"
                    data-control="lsp-btn"
                    data-variant="primary"
                    data-size="xs"
                    data-install={props.server.name}
                    data-option={index()}
                    title="Install language server"
                    disabled={props.disabled}
                    onClick={() => props.onInstall(props.server.name, index())}
                  >
                    Install
                  </button>
                </Match>
              </Switch>
              <button
                class="btn"
                data-control="lsp-btn"
                data-variant="outline"
                data-size="xs"
                data-copy={option.cmd}
                title="Copy command to clipboard"
                onClick={() => void copyText(option.cmd)}
              >
                Copy
              </button>
            </span>
          </div>
        )}
      </For>
      <Show when={props.server.job}>{(job) => <Job job={job()} />}</Show>
    </div>
  );
}
function Job(props: { job: InstallJob }): JSX.Element {
  return (
    <Show when={props.job.running || props.job.error}>
      <div data-ui="lsp-job" class="p-3" classList={{ 'text-destructive': !!props.job.error }}>
        <Show when={props.job.running} fallback={<>Install failed: {props.job.error}</>}>
          Installing with <code>{props.job.cmd}</code>…
        </Show>
        <Show when={installLog(props.job)}>
          <pre>{installLog(props.job)}</pre>
        </Show>
      </div>
    </Show>
  );
}
