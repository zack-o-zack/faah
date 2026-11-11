# Provider and model picker

Captured from the running app with its local catalogue of 523 models. The
provider column stays independent; search filters only the active provider's
models. Both columns scroll within a bounded popover. All surfaces, text and
selection colors come from the current theme.

![Dark theme](dark.png)
![Light theme](light.png)

Validation: provider/model grouping and search unit tests; browser checks for
search, no results, exact selection payload (intercepted to avoid changing saved
settings), keyboard selection, Escape/focus restoration, and viewport containment
at 1280×800 and 390×640. Frontend checks, Go tests and desktop tests passed.
