import type { JSX } from 'solid-js';
import { For } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { Popover } from '../lib/Popover.tsx';

export function DiffOptions(props: { id: string }): JSX.Element {
  const editor = useEditor();
  const whitespaceId = () => props.id + '-ignore-whitespace';
  const changedWordsId = () => props.id + '-highlight-changed-words';
  return (
    <Popover
      triggerId={props.id}
      triggerTitle="Diff options"
      accessibleLabel="Diff options"
      variant="ghost"
      size="icon-xs"
      autofocus
      label={<span class="icon-[ph--gear-six] size-3.5 shrink-0" aria-hidden="true" />}
    >
      <div class="flex flex-col gap-3 p-3 text-xs">
        <h3 class="font-medium">Diff options</h3>
        <div class="flex flex-col gap-1.5">
          <span>Layout</span>
          <div class="button-group" role="group" aria-label="Layout">
            <For
              each={[
                { label: 'Side by side', split: true },
                { label: 'Unified', split: false },
              ]}
            >
              {(option) => (
                <button
                  type="button"
                  class="btn"
                  data-size="sm"
                  aria-pressed={editor.settings.preferences().splitDiff === option.split}
                  data-variant="outline"
                  onClick={() =>
                    void editor.settings.actions.setSetting(
                      'diffEditor.renderSideBySide',
                      option.split,
                    )
                  }
                >
                  {option.label}
                </button>
              )}
            </For>
          </div>
        </div>
        <div class="field" data-orientation="horizontal">
          <section>
            <label for={whitespaceId()}>Ignore whitespace</label>
            <p>Hides changes in spaces and blank lines</p>
          </section>
          <input
            id={whitespaceId()}
            type="checkbox"
            role="switch"
            class="input"
            aria-label="Ignore whitespace"
            checked={editor.settings.value('diffEditor.ignoreWhitespace') === true}
            aria-checked={editor.settings.value('diffEditor.ignoreWhitespace') === true}
            onChange={(event) =>
              void editor.settings.actions.setSetting(
                'diffEditor.ignoreWhitespace',
                event.currentTarget.checked,
              )
            }
          />
        </div>
        <div class="field" data-orientation="horizontal">
          <section>
            <label for={changedWordsId()}>Highlight changed words</label>
            <p>Marks the exact words that changed in a line</p>
          </section>
          <input
            id={changedWordsId()}
            type="checkbox"
            role="switch"
            class="input"
            aria-label="Highlight changed words"
            checked={editor.settings.preferences().highlightChangedWords}
            aria-checked={editor.settings.preferences().highlightChangedWords}
            onChange={(event) =>
              void editor.settings.actions.setSetting(
                'diffEditor.highlightChangedWords',
                event.currentTarget.checked,
              )
            }
          />
        </div>
      </div>
    </Popover>
  );
}
