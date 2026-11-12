import { EditControls } from './EditControls.jsx';
export function FileActions() {
  return (
    <div id="file-actions" class="flex shrink-0 items-center gap-1 px-1">
      {/* Markdown and table files only: rendered view or source */}
      <div id="md-switch" class="button-group" role="group" aria-label="Preview or source" hidden>
        <button
          data-md="preview"
          title="Rendered view ({Alt+M})"
          class="btn"
          data-variant="outline"
          data-size="xs"
        >
          Preview
        </button>
        <button
          data-md="source"
          title="File source ({Alt+M})"
          class="btn"
          data-variant="outline"
          data-size="xs"
        >
          Source
        </button>
      </div>
      {/* Files with changes only: the file, or what changed in it */}
      <div id="diff-switch" class="button-group" role="group" aria-label="File or changes" hidden>
        <button
          id="diff-source"
          title="Show the file ({Mod+D})"
          class="btn"
          data-variant="outline"
          data-size="xs"
        >
          File
        </button>
        <button
          id="diff-btn"
          title="Show what changed in this file ({Mod+D})"
          class="btn"
          data-variant="outline"
          data-size="xs"
        >
          Changes
        </button>
      </div>
      <button
        id="diff-layout"
        title="Show changes in one column"
        aria-label="Show changes in one column"
        class="btn"
        data-variant="ghost"
        data-size="icon-xs"
        hidden
      >
        <span
          id="diff-layout-split"
          class="icon-[lucide--rectangle-vertical] size-3.5 shrink-0"
          aria-hidden="true"
        />
        <span
          id="diff-layout-unified"
          class="icon-[lucide--columns-2] size-3.5 shrink-0"
          aria-hidden="true"
          hidden
        />
      </button>
      <EditControls />
    </div>
  );
}
