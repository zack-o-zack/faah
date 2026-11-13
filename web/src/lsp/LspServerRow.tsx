import type { JSX } from 'solid-js';
import type { ServerInfo } from './decode.ts';
import { Match, Switch } from 'solid-js';
import { copyText } from '../lib/clipboard.ts';
import { fmtBytes } from '../status/logic.ts';
import { serverPresentation, shortLanguage } from './logic.ts';
interface LspServerRowProps {
  server: ServerInfo;
  pending: boolean;
  onAction: (kind: string, params: { server: string; option?: number }) => void;
}
export function LspServerRow(props: LspServerRowProps): JSX.Element {
  const view = () => serverPresentation(props.server);
  return (
    <div data-ui="lsp-server-row" class="contents">
      <span
        data-ui="lsp-dot"
        class={
          view().busy
            ? 'icon-[lucide--loader-circle] size-3 animate-spin text-muted-foreground'
            : `mx-0.5 size-2 rounded-full ${view().dot}`
        }
        aria-label={view().busy ? 'Working' : undefined}
      />
      <span data-ui="lsp-server-info" class="min-w-0 truncate">
        <span data-ui="lsp-server-name" class="font-medium">
          {props.server.name}
        </span>{' '}
        <span data-ui="lsp-server-lang" class="text-muted-foreground">
          {shortLanguage(props.server.lang)}
        </span>
      </span>
      <span
        data-ui="lsp-server-meta"
        class="max-w-40 truncate text-right tabular-nums text-muted-foreground"
        title={props.server.error || view().note}
      >
        {props.server.running && props.server.memBytes
          ? fmtBytes(props.server.memBytes)
          : view().note}
      </span>
      <Switch fallback={<span />}>
        <Match when={view().action === 'start' || view().action === 'stop'}>
          <button
            class={`btn ${view().action === 'stop' ? 'text-destructive' : 'text-muted-foreground hover:text-foreground'}`}
            data-control="lsp-btn"
            data-variant="ghost"
            data-size="icon-xs"
            data-name={props.server.name}
            data-act={view().action}
            title={`${view().label} ${props.server.name}`}
            aria-label={`${view().label} ${props.server.name}`}
            disabled={props.pending}
            onClick={() => props.onAction(view().action, { server: props.server.name })}
          >
            <span
              class={`${view().action === 'start' ? 'icon-[lucide--play]' : 'icon-[lucide--square]'} size-3`}
              aria-hidden="true"
            />
          </button>
        </Match>
        <Match when={view().action === 'install'}>
          <button
            class="btn"
            data-control="lsp-btn"
            data-variant="ghost"
            data-size="xs"
            data-name={props.server.name}
            data-opt={props.server.autoOpt}
            data-act="install"
            title={`Install ${props.server.name}`}
            disabled={props.pending}
            onClick={() =>
              props.onAction('install', { server: props.server.name, option: props.server.autoOpt })
            }
          >
            Install
          </button>
        </Match>
        <Match when={view().action === 'copy'}>
          <button
            class="btn"
            data-control="lsp-btn"
            data-variant="ghost"
            data-size="xs"
            data-act="copy"
            data-cmd={props.server.options[0]?.cmd}
            title={`Copy install command: ${props.server.options[0]?.cmd}`}
            onClick={() => void copyText(props.server.options[0]?.cmd || '')}
          >
            Copy command
          </button>
        </Match>
      </Switch>
    </div>
  );
}
