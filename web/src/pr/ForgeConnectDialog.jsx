import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { Dialog } from '../lib/Dialog.tsx';
import { ErrorNotice } from '../lib/ErrorNotice.tsx';
import { keyLabel } from '../lib/keyboard.ts';
import { FORGE_SOURCES } from './logic.ts';
// Everything forge-specific comes from the server's token setup for this host.
export function ForgeConnectDialog() {
  const editor = useEditor();
  const connect = editor.forge.state;
  const forge = () => editor.forge.forge();
  const setup = () => forge().setup || { steps: [] };
  return (
    <Show when={connect.open && forge()}>
      <Dialog
        open={true}
        title={`Connect ${forge().info.label}`}
        subtitle={forge().host || ''}
        class="max-w-lg"
        onClose={editor.actions.closeForgeConnect}
        footer={
          <>
            <button
              type="button"
              class="btn text-primary-text"
              data-variant="link"
              data-size="xs"
              onClick={() => {
                editor.actions.closeForgeConnect();
                editor.actions.openSettings(
                  'ui',
                  forge().info.tokenCategory,
                  forge().info.tokenKey,
                );
              }}
            >
              Open Settings
            </button>
            <span class="flex-1 text-xs text-muted-foreground">
              {keyLabel('Enter')} to connect, Esc to cancel
            </span>
            <button
              type="button"
              class="btn"
              data-variant="ghost"
              data-size="xs"
              onClick={editor.actions.closeForgeConnect}
            >
              Cancel
            </button>
            <button
              id="forge-connect-submit"
              type="submit"
              form="forge-connect-form"
              class="btn"
              data-variant="primary"
              data-size="xs"
              disabled={connect.pending}
            >
              {connect.pending ? 'Checking...' : 'Connect'}
            </button>
          </>
        }
      >
        <form
          id="forge-connect-form"
          class="flex flex-col gap-3 overflow-auto"
          onSubmit={(event) => {
            event.preventDefault();
            void editor.actions.submitForgeConnect();
          }}
        >
          <p class="text-muted-foreground">
            <Show
              when={forge().hasToken}
              fallback={
                <>
                  <Show when={connect.reason}>
                    A {forge().info.label} token is needed {connect.reason}.{' '}
                  </Show>
                  {setup().readonly || ''}
                </>
              }
            >
              faah is using {FORGE_SOURCES[forge().source] || 'a token'} for {forge().host}. Paste a
              new one to replace it.
            </Show>
          </p>
          <ol class="flex list-decimal flex-col gap-2 pl-6">
            <li>
              Open{' '}
              <a
                href={setup().url}
                target="_blank"
                rel="noopener noreferrer"
                class="text-primary-text"
              >
                {forge().info.label}'s token page on {forge().host}
              </a>
              .
            </li>
            <For each={setup().steps}>{(step) => <li>{step}</li>}</For>
            <li>Paste it below.</li>
          </ol>
          <label class="label text-muted-foreground" for="forge-connect-token">
            Token
          </label>
          <input
            id="forge-connect-token"
            type="password"
            spellcheck={false}
            autocomplete="off"
            placeholder="Paste the token"
            class="input h-8!"
            autofocus
            value={connect.token}
            onInput={(event) => editor.actions.setForgeToken(event.currentTarget.value)}
          />
          <Show when={setup().extra}>
            <label class="label text-muted-foreground" for="forge-connect-extra">
              {setup().extra.label}
            </label>
            <input
              id="forge-connect-extra"
              type="text"
              spellcheck={false}
              autocomplete="off"
              placeholder={setup().extra.placeholder}
              class="input h-8!"
              value={connect.extra}
              onInput={(event) => editor.actions.setForgeExtra(event.currentTarget.value)}
            />
            <span class="text-xs text-muted-foreground">{setup().extra.hint}</span>
          </Show>
          <ErrorNotice error={connect.error} />
          <span class="text-xs text-muted-foreground">
            {editor.pr.available()
              ? 'faah checks the token by reading this pull request with it before saving it.'
              : 'Saved to your faah settings. It is checked the next time you open a pull request.'}
          </span>
          <span class="text-xs text-muted-foreground">
            Or set <code>{setup().env}</code>
            <Show when={setup().cli}>
              {' '}
              or run <code>{setup().cli}</code>
            </Show>{' '}
            in your shell, then restart faah.
            <Show when={setup().hostKey}> faah sends the token only to {forge().host}.</Show>
          </span>
        </form>
      </Dialog>
    </Show>
  );
}
