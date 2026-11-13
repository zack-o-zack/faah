// Removed when the last legacy module is migrated.
export function LegacyTips() {
  return (
    <>
      <div
        data-ui="tips-header-bar"
        class="inspector-bar flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2 text-xs flex items-center gap-2 p-3"
      >
        <div
          data-ui="tips-search-wrap"
          class="flex items-center flex-1 gap-2 p-3 text-muted-foreground"
        >
          <span class="icon-[lucide--search] size-3.5 shrink-0" aria-hidden="true" />
          <input
            type="text"
            id="tips-filter"
            aria-label="Filter tips"
            placeholder="Filter tips..."
            autocomplete="off"
            spellcheck="false"
            class="input"
          />
        </div>
        <span
          id="tips-count-badge"
          class="badge"
          data-variant="secondary"
          data-control="inspector-badge"
        >
          0 tips
        </span>
        <button
          id="btn-refresh-tips"
          title="Reload tips"
          class="btn"
          data-control="icon-action"
          data-variant="ghost"
          data-size="icon-xs"
          aria-label="Reload tips"
        >
          <span class="icon-[lucide--rotate-cw] size-3.5 shrink-0" aria-hidden="true" />
        </button>
      </div>
      <div data-ui="tips-toolbar-sub" class="flex items-center justify-between p-3">
        <label
          title="Toggle automatic tip popups in interface"
          data-ui="tips-setting-toggle"
          class="label inline-flex items-center cursor-pointer select-none gap-2 text-muted-foreground"
        >
          <input type="checkbox" id="tips-toggle-popup" checked={true} class="input" />
          <span>Show tip popups in interface</span>
        </label>
      </div>
      <div
        class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3 [&>*]:shrink-0"
        id="tips-list"
      />
    </>
  );
}
