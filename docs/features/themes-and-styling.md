# Themes and styling

The app ships with **Light** (`light`) and **Dark** (`dark`).
System is the default: dark OS appearance selects Dark, otherwise Light.
The palette uses neutral surfaces and readable ink for text, syntax,
search, selections and diffs.

The brand green is reserved for the logo, the threads panel's thinking spiral and agent send buttons.
Other AI busy states use a rotating starburst in the idle icon's colour and size.
Primary actions use ink. Pull request states use the familiar filled pills:
green Open, purple Merged, red Closed and grey Draft, all with white text.
Other badges use neutral fills with readable text.
Git status and checks use the same familiar colours: added lines, added files and passed
checks are green, modified files are amber, and deleted lines and files are red.

## Choose a theme

- Open Settings with `Cmd/Ctrl+,`, then choose **Workbench > Color Theme**.
- Or open the command palette and choose **Select Theme…**. Arrow keys preview;
  Enter saves the choice and Escape restores the previous preference.
- The workbench footer and Color Theme setting share **System**, **Light** and
  **Dark** icon buttons. Arrow keys move between choices. Extra user themes
  appear in a separate settings select only when installed.

The choice is saved as `workbench.colorTheme` in `~/.faah/settings.json`, or
`$XDG_CONFIG_HOME/faah/settings.json` when configured. An empty string means
System. A configured ID wins over the browser's saved ID. Unknown or removed
IDs follow the OS; they are never migrated or aliased. While System is selected,
OS appearance changes update the app without reloading.

Floating menus, popovers, the palette, dialogs and hover cards use frosted layers, as do the review header, PR footer, editor status footer and Git panel. In **Workbench > Transparency**, choose **off**, **subtle** (default) or **strong**; the OS reduce-transparency preference always forces solid layers.

## Code themes

The app theme colours the whole app. A **code theme** colours only code: the
editor, the diff views, Markdown code blocks and the hover card signature. A
toolbar, tab, sidebar or button around those surfaces keeps the app theme.

There is one choice per app scheme. Open Settings with `Cmd/Ctrl+,`, then use
**Workbench > Code Theme (Light)** and **Workbench > Code Theme (Dark)**. Each
select lists **fibo light** or **fibo dark** plus the installed themes that declare that scheme. The
active app scheme decides which of the two applies, so switching Light and Dark
swaps the code theme with it; in System mode the OS appearance decides, live.

**fibo light** and **fibo dark** are the defaults and have no file: it means "use the app theme's own code
colours". The choice is saved as `workbench.codeTheme.light` and
`workbench.codeTheme.dark`. An empty or unavailable ID falls back to them, and
the server rejects unknown IDs.

Built-in code themes:

| ID | Name | Scheme |
| --- | --- | --- |
| `catppuccin-latte` | Catppuccin Latte | light |
| `classic-light` | Classic Light | light |
| `gruvbox-light` | Gruvbox Light | light |
| `solarized-light` | Solarized Light | light |
| `catppuccin-mocha` | Catppuccin Mocha | dark |
| `classic-dark` | Classic Dark | dark |
| `dracula` | Dracula | dark |
| `gruvbox-dark` | Gruvbox Dark | dark |
| `midnight` | Midnight | dark |
| `monokai` | Monokai | dark |
| `nord` | Nord | dark |
| `one-dark` | One Dark | dark |
| `rose-pine` | Rose Pine | dark |
| `solarized-dark` | Solarized Dark | dark |

## Add a code theme

Put a CSS file in `~/.faah/themes/`, the same folder as user app themes, and
reload. A code theme is recognised by its selector: it must end in
`.code-surface`.

```css
:root[data-code-theme="my-code"] .code-surface {
  --theme-name: "My Code";
  color-scheme: dark;

  --background: #14161a; --foreground: #d7dae0; --muted-foreground: #9aa0ab;
  --faint: #6f7682; --border: #262b33;
  --sel: #2b3550; --cur: #1b1f26; --mark: rgba(240, 200, 90, 0.25);
  --mark-active: #f0c85a; --on-mark-active: #14161a;
  --gi: #7bd88f; --gd: #f2777a; --gi-bg: rgba(123, 216, 143, 0.15);
  --gd-bg: rgba(242, 119, 122, 0.15); --gi-word: #2b3f2f; --gd-word: #45282a;
  --err: #f2777a; --warn: #f0c85a;
  --k: #c792ea; --kt: #ffcb6b; --nf: #82aaff; --nc: #ffcb6b; --nb: #89ddff;
  --nv: #d7dae0; --no: #f78c6c; --na: #ffcb6b; --nt: #82aaff; --nd: #f78c6c;
  --np: #89ddff; --s: #c3e88d; --m: #f78c6c; --o: #89ddff; --p: #a6accd;
  --c: #7f848e; --cp: #c792ea;
}
```

`color-scheme` puts the theme in the light or dark select; a file without it
sorts into light. `--theme-name` is the option label. A code theme may set only
the tokens above — the [styling contract](../internals/styling-and-themes.md#code-themes-and-code-surfaces)
lists each group. App-chrome tokens such as `--sidebar` or `--primary` belong to
app themes; a code surface ignores them. User code themes share the app theme
limits: 256 KiB per file and 1 MiB of user CSS per request.

## Override colours or add a theme

Create `~/.faah/themes/` and put CSS files there. This data folder stays under
your home directory even if settings use `XDG_CONFIG_HOME`. Reload after editing.
For example, `overrides.css` changes two tokens in Dark:

```css
:root[data-theme="dark"] {
  --surface-raised: var(--surface);
  --hover: var(--surface-sunken);
}
```

Built-in CSS loads first, then user CSS in filename order. Later definitions
win. Each file is limited to 256 KiB, with a total of 1 MiB of user CSS per
request; unreadable, oversized and non-regular files are skipped and logged.
A missing theme folder is fine. No rebuild is needed.

To add a new theme, copy the complete example in the
[theme contract](../internals/styling-and-themes.md#theme-contract), choose a
unique `data-theme` ID and `--theme-name`, and declare `color-scheme`. The picker
discovers it from CSS automatically. The same contract lists required tokens,
fallbacks and contrast checks. This phase changes colours only; fonts, shapes
and logo assets retain their existing implementation.
