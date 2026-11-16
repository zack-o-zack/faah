# Themes and styling

The app ships with **fibo light** (`fibo-light`) and **fibo dark** (`fibo-dark`).
System is the default: dark OS appearance selects fibo dark, otherwise fibo light.
The palette uses quiet surfaces, pastel fills and readable ink for text, syntax,
search, selections and diffs.

## Choose a theme

- Open Settings with `Cmd/Ctrl+,`, then choose **Workbench > Color Theme**.
- Or open the command palette and choose **Select Theme…**. Arrow keys preview;
  Enter saves the choice and Escape restores the previous preference.
- The workbench launcher has a theme menu with a **System** option.

The choice is saved as `workbench.colorTheme` in `~/.faah/settings.json`, or
`$XDG_CONFIG_HOME/faah/settings.json` when configured. An empty string means
System. A configured ID wins over the browser's saved ID. Unknown or removed
IDs follow the OS; they are never migrated or aliased. While System is selected,
OS appearance changes update the app without reloading.

## Override colours or add a theme

Create `~/.faah/themes/` and put CSS files there. This data folder stays under
your home directory even if settings use `XDG_CONFIG_HOME`. Reload after editing.
For example, `overrides.css` changes two tokens in fibo dark:

```css
:root[data-theme="fibo-dark"] {
  --spiral: #b8e6a0;
  --surface-raised: #202820;
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
