import type { ForgeMeta } from './types.ts';
import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { ReviewDialogHeader } from './ReviewDialogHeader.tsx';
import { ReviewDialogFooter } from './ReviewDialogFooter.tsx';
import { Dialog } from '../lib/Dialog.tsx';
import { ErrorNotice } from '../lib/ErrorNotice.tsx';
import { keyLabel } from '../lib/keyboard.ts';
import { FORGE_SOURCES } from './logic.ts';
// Everything forge-specific comes from the server's token setup for this host.
export function ForgeConnectDialog(): JSX.Element {
  const editor = useEditor();
  const connect = editor.forge.state;
  const forge = () => editor.forge.forge();
  const setup = (): Partial<NonNullable<ForgeMeta['setup']>> => forge()?.setup || { steps: [] };
  return (
    <Show when={connect.open && forge()}>
      <Dialog
        open={true}
        bare
        id="forge-connect-modal"
        title={`Connect ${forge()?.info.label}`}
        onClose={editor.actions.closeForgeConnect}
      >
        <form
          class="overflow-auto"
          onSubmit={(event) => {
            event.preventDefault();
            void editor.actions.submitForgeConnect();
          }}
        >
          <ReviewDialogHeader
            prefix="forge-connect"
            title={`Connect ${forge()?.info.label}`}
            onClose={editor.actions.closeForgeConnect}
          >
            {forge()?.host || ''}
          </ReviewDialogHeader>
          <section class="flex flex-col gap-3 overflow-auto">
            <p id="forge-connect-why" data-ui="pr-merge-explain" class="text-muted-foreground">
              <Show
                when={forge()?.hasToken}
                fallback={
                  <>
                    <Show when={connect.reason}>
                      A {forge()?.info.label} token is needed {connect.reason}.{' '}
                    </Show>
                    {setup().readonly || ''}
                  </>
                }
              >
                faah is using {FORGE_SOURCES[forge()?.source || ''] || 'a token'} for{' '}
                {forge()?.host}. Paste a new one to replace it.
              </Show>
            </p>
            <ol
              id="forge-connect-steps"
              data-ui="forge-connect-steps"
              class="list-decimal pl-6 flex flex-col gap-2"
            >
              <li>
                Open{' '}
                <a
                  href={setup().url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-primary-text"
                >
                  {forge()?.info.label}'s token page on {forge()?.host}
                </a>
                .
              </li>
              <For each={setup().steps}>{(step) => <li>{step}</li>}</For>
              <li>Paste it below.</li>
            </ol>
            {/* aislop-ignore-next-line jsx-a11y/label-has-associated-control -- Solid binds this label with for to forge-connect-token. */}
            <label
              data-ui="pr-merge-label"
              class="label label text-muted-foreground"
              for="forge-connect-token"
            >
              Token
            </label>
            <input
              id="forge-connect-token"
              type="password"
              spellcheck={false}
              autocomplete="off"
              placeholder="Paste the token"
              class="input h-8!"
              data-control="pr-merge-input"
              autofocus
              value={connect.token}
              onInput={(event) => editor.actions.setForgeToken(event.currentTarget.value)}
            />
            <Show when={setup().extra}>
              <div
                id="forge-connect-extra"
                data-ui="forge-connect-extra"
                class="flex flex-col gap-2"
              >
                <label
                  data-ui="pr-merge-label"
                  class="label label text-muted-foreground"
                  id="forge-connect-extra-label"
                  for="forge-connect-extra-input"
                >
                  {setup().extra?.label}
                </label>
                <input
                  id="forge-connect-extra-input"
                  type="text"
                  spellcheck={false}
                  autocomplete="off"
                  placeholder={setup().extra?.placeholder}
                  class="input h-8!"
                  data-control="pr-merge-input"
                  value={connect.extra}
                  onInput={(event) => editor.actions.setForgeExtra(event.currentTarget.value)}
                />
                <span
                  id="forge-connect-extra-hint"
                  data-ui="pr-merge-note"
                  class="text-muted-foreground"
                >
                  {setup().extra?.hint}
                </span>
              </div>
            </Show>
            <div id="forge-connect-err" data-ui="agent-err" hidden={!connect.error}>
              <ErrorNotice error={connect.error} />
            </div>
            <span id="forge-connect-check" data-ui="pr-merge-note" class="text-muted-foreground">
              {editor.pr.available()
                ? 'faah checks the token by reading this pull request with it before saving it.'
                : 'Saved to your faah settings. It is checked the next time you open a pull request.'}
            </span>
            <span id="forge-connect-alt" data-ui="pr-merge-note" class="text-muted-foreground">
              Or set <code>{setup().env}</code>
              <Show when={setup().cli}>
                {' '}
                or run <code>{setup().cli}</code>
              </Show>{' '}
              in your shell, then restart faah.
              <Show when={setup().hostKey}> faah sends the token only to {forge()?.host}.</Show>
            </span>
          </section>
          <ReviewDialogFooter
            prefix="forge-connect"
            hint={`${keyLabel('Enter')} to connect, Esc to cancel`}
            confirm={connect.pending ? 'Checking...' : 'Connect'}
            disabled={connect.pending}
            onClose={editor.actions.closeForgeConnect}
            onConfirm={editor.actions.submitForgeConnect}
          >
            {/* aislop-ignore-next-line jsx-a11y/anchor-is-valid -- Settings navigation stays inside the reader. */}
            <a
              id="forge-connect-settings"
              href="#"
              data-ui="pr-merge-link"
              class="text-primary-text"
              onClick={(event) => {
                event.preventDefault();
                editor.actions.closeForgeConnect();
                editor.actions.openSettings(
                  'ui',
                  forge()?.info.tokenCategory,
                  forge()?.info.tokenKey,
                );
              }}
            >
              Open Settings
            </a>
          </ReviewDialogFooter>
        </form>
      </Dialog>
    </Show>
  );
}
