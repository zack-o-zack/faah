# Tailwind and Basecoat UI Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the whole faah web UI (editor app, workbench, holding page, desktop shell) from hand-written CSS to Tailwind CSS v4 utilities and Basecoat components.

**Architecture:** One Tailwind entry file, `web/tailwind.css`, imports Tailwind, the Basecoat Vega bundle and faah's theme mapping, and the build writes it to `web/app.css`. Themes stay one file each under `web/themes/` and now set the Basecoat token names. Markup uses Basecoat component classes (`btn`, `input`, `dialog`, `dropdown-menu`, `card`, `badge`, `kbd`, `tabs`, `command`, `toast`) and Tailwind utilities for layout. faah's own JavaScript stays the controller for every menu, dialog and palette; Basecoat JavaScript is not loaded. `web/style.css`, `web/workbench.css` and `web/desktop.css` are deleted at the end. Rules that style HTML that faah generates at runtime and cannot carry utility classes (Chroma syntax spans, rendered Markdown, Mermaid output, diff gutters) live in `@layer components` in the entry file.

**Tech Stack:** Tailwind CSS 4 (`tailwindcss`, `@tailwindcss/cli`), Basecoat 1.1.0 (`basecoat-css`, Vega style), vanilla ES modules bundled by `scripts/build-web.js`, Go `embed` server.

---

## Design rules (every phase)

1. No backward compatibility. When a mechanism moves, the old one is deleted in the same phase: no alias tokens, no duplicate class names, no fallbacks.
2. One controller per widget. Keep faah's JavaScript behaviour. Change markup and classes only, unless a phase says otherwise.
3. Class names in JavaScript are complete literal strings, so Tailwind's scanner finds them. Never build a class name from parts (`'text-' + size`).
4. Colours come from tokens only. Utilities use the mapped names (`bg-sidebar`, `text-muted-foreground`, `border-border`). No hex, rgb or oklch values outside `web/themes/`.
5. Theme files hold tokens only. Component styling never goes in a theme.
6. Keep every `id`, `role`, `aria-*`, `data-*` and `hidden` attribute that JavaScript or tests read.
7. After each phase: `node scripts/build-web.js`, `node scripts/check-web.js`, `bun test web/src/`, `go test ./...`, `npm test --prefix desktop` all pass.
8. Commit messages: imperative sentence case, no AI attribution, no names of other products.
9. The goal is a working app on the new system, not visual parity. Use Basecoat components with their default look and only the layout utilities they need (position, size, gap, overflow). Do not add utilities or overrides to reproduce old sizes, spacing, colours or radii, and delete shims whose only job was to keep the old look. Screenshots are checked for broken behaviour, clipping, overflow and unreadable states.

## Token vocabulary (phase 1)

Every theme in `web/themes/*.css` sets these names. The old names are removed everywhere.

| Old faah token | New token | Notes |
| --- | --- | --- |
| `--bg` | `--background` | editor surface |
| `--fg` | `--foreground` | |
| `--bg2` | `--sidebar` and `--card` | both set to the old `--bg2` value |
| `--bg3` | `--popover`, `--secondary`, `--muted` | all set to the old `--bg3` value |
| `--bg4` | `--accent` | hover and active surface, as Basecoat expects |
| `--dim` | `--muted-foreground` | |
| `--faint` | `--faint` | kept, faah-only |
| `--line` | `--border`, `--input`, `--sidebar-border` | |
| `--accent` | `--primary`, `--ring`, `--sidebar-primary`, `--sidebar-ring` | |
| `--on-accent` | `--primary-foreground`, `--sidebar-primary-foreground` | |
| `--accent-fg` | `--primary-text` | accent-coloured text, faah-only |
| `--err` | `--destructive` and `--err` | `--err` stays as the syntax error token |
| (new) | `--card-foreground`, `--popover-foreground`, `--secondary-foreground`, `--accent-foreground`, `--sidebar-foreground`, `--sidebar-accent-foreground` | set to the old `--fg` value |
| (new) | `--sidebar-accent` | set to the old `--bg3` value |
| `--ring` (a box-shadow in desktop.css) | `--focus-shadow` | `--ring` is now a colour |
| `--border` (current ad-hoc uses) | review each use, map to `--border` colour | |

Unchanged faah-only tokens: `--sel`, `--mark`, `--mark-active`, `--cur`, `--shadow`, `--shadow-sm`, `--scrim`, `--on-badge`, `--on-mark-active`, every syntax token (`--k`, `--s`, …), every diff token (`--gi`, `--gd`, `--gi-bg`, `--gd-bg`), `--warn`, `--red`, `--green`, `--yellow`, the type scale `--t-*`, `--mono`, `--ui`, `--lh`, `--fs`, `--tab-size`.

`theme.js` adds the class `dark` on `<html>` when the active theme's `color-scheme` is `dark`, and removes it otherwise, so Basecoat's `dark:` rules follow the theme.

## Tailwind theme mapping (phase 1)

In `web/tailwind.css`, after the Basecoat import:

```css
@import "tailwindcss" source(none);
@import "basecoat-css/vega";

@source "./index.html";
@source "./workbench.html";
@source "./src";
@source "../workbench.go";

@custom-variant dark (&:where(.dark, .dark *));
@custom-variant desktop (&:where([data-shell], [data-shell] *));
@custom-variant win-linux (&:where([data-platform="win"], [data-platform="linux"], [data-platform="win"] *, [data-platform="linux"] *));

@theme inline {
  --font-sans: var(--ui);
  --font-mono: var(--mono);
  --color-faint: var(--faint);
  --color-primary-text: var(--primary-text);
  --color-sel: var(--sel);
  --color-mark: var(--mark);
  --color-mark-active: var(--mark-active);
  --color-cur: var(--cur);
  --color-gi: var(--gi);
  --color-gd: var(--gd);
  --color-gi-bg: var(--gi-bg);
  --color-gd-bg: var(--gd-bg);
  --color-warn: var(--warn);
  --text-8-5: var(--t-8-5); --text-9: var(--t-9); --text-9-5: var(--t-9-5);
  --text-10: var(--t-10); --text-10-5: var(--t-10-5); --text-11: var(--t-11);
  --text-11-5: var(--t-11-5); --text-12: var(--t-12); --text-12-5: var(--t-12-5);
  --text-13: var(--t-13); --text-13-5: var(--t-13-5); --text-14: var(--t-14);
  --text-14-5: var(--t-14-5); --text-15: var(--t-15); --text-16: var(--t-16);
  --text-18: var(--t-18);
}
```

Basecoat already maps `--color-background`, `--color-primary`, `--color-sidebar`, `--color-border` and the rest of its tokens; check the bundle and add only the missing ones.

## Phases

Each phase is one brief to the implementing agent and ends with before and after screenshots of the same screens in Catppuccin Mocha (dark) and Paper (light).

### Phase 1: Build pipeline and tokens

**Files:**
- Create: `web/tailwind.css` (entry), root `package-lock.json`
- Modify: `package.json` (devDependencies `tailwindcss`, `@tailwindcss/cli`, `basecoat-css@1.1.0`), `scripts/build-web.js` (run the Tailwind CLI, `--minify`, output `web/app.css`), `.gitignore` (`web/app.css`), `server.go` (embed `web/app.css`, drop the three old CSS files once they are imported), `web/index.html`, `web/workbench.html`, `workbench.go` (holding page head) to link only `static/app.css` and `static/themes.css`, every file in `web/themes/`, every `var(--…)` use in `web/*.css` and `web/src/*.js`, `web/src/theme.js` (dark class), `.github/workflows/*.yml` (`npm ci` at the root before `build-web.js`), `desktop/dev-reload.cjs` and its test (CSS reload now watches `app.css`), `px0_test.go`, `devassets_test.go`, `web/src/typescale.test.js`, `docs/internals/styling-and-themes.md`.

- [ ] Add the npm packages and the Tailwind build step. `build-web.js` fails with a clear message when `node_modules` is missing.
- [ ] Move the old stylesheets into the entry: `@import "./style.css" layer(components); @import "./workbench.css" layer(components); @import "./desktop.css" layer(components);` after Basecoat, so utilities override them while later phases delete them.
- [ ] Rename tokens per the table, in themes and in every use.
- [ ] Neutralise Tailwind preflight where faah relied on browser defaults (rendered Markdown headings and lists, `img` display, `button` and `input` resets) by adding explicit rules next to the affected component rules. Compare screenshots until they match the baseline.
- [ ] Update the theme conformance test to require the new token names.
- [ ] Commit.

### Phase 2: Controls

Buttons, icon buttons, toggles and segmented controls, text inputs, textareas, selects, checkboxes, switches, badges, keycaps.

- Buttons: `.mini`, `.footer-btn`, `.toggle-btn`, `.top-bar-btn`, `.tip-btn*`, `.git-*` action buttons, `.pr-btn*`, settings buttons and every other `<button>` with its own look become `class="btn"` plus `data-variant` (`ghost` for toolbar icons, `outline` for secondary, none for primary, `destructive`) and `data-size` (`icon-xs` or `icon-sm` for icon buttons in dense rows, `xs` or `sm` for text buttons). Two-state toggles use `aria-pressed`. Grouped buttons use `role="group" class="button-group"`.
- Inputs: `class="input"`, `class="textarea"`; native selects `class="select"` (Basecoat native select). Checkboxes `class="input" type="checkbox"`; switches `type="checkbox" role="switch" class="input"` per Basecoat markup.
- Badges: `class="badge"` with `data-variant` (`secondary`, `outline`). Keycaps: `<kbd class="kbd">`.
- Delete every replaced rule from the old stylesheets.

### Phase 3: Overlays

Modals (`.modal-overlay`: settings, merge, forge connect and the rest) become native `<dialog class="dialog">` with Basecoat's `header`, `section`, `footer` structure, opened with `showModal()` and closed with `close()`; Escape and backdrop click keep their current behaviour. Context and dropdown menus (`#sel-menu`, `#tree-menu`, `#metrics-menu`, `#lsp-menu`, `#diff-menu`, `#pr-merge-menu`, branch menus) use Basecoat dropdown-menu markup: a `[data-popover]` panel with `role="menu"` and `role="menuitem"` items, `hr role="separator"`, faah JavaScript keeps positioning and keyboard handling. The command palette (`#overlay`, `#palette`) uses Basecoat `command` markup inside a `dialog`. `#toast` uses Basecoat `toaster` and `toast` markup. Hovercards, the find bar, the tips card and the shortcut sheet use the popover and card styles. Delete replaced rules.

### Phase 4: App shell

Explorer sidebar and tree rows, scope bar, unpushed and git panels, top bar and Code/Review switch (Basecoat `tabs`), file tabs, editor frame, minimap frame, inspector, threads column, status bar and its fit steps, resizers. Layout moves to utilities in `web/index.html` and the JavaScript that builds these regions. Delete replaced rules.

### Phase 5: Feature surfaces

Settings body, search and find, symbol outline, hover and references, metrics, image view, new-item prompts, line comments and selection bar, PR review, review flow and walkthrough, merge, agent and thread panels, diff view chrome. Utilities and Basecoat components (`card`, `item`, `field`, `label`, `empty`, `alert`, `table`). Delete replaced rules.

### Phase 6: Workbench, holding page, desktop shell, final removal

Workbench (`web/workbench.html`, `web/src/workbench.js`), holding page (`workbench.go` template, `web/src/holding.js`), desktop rules moved to the `desktop:` and `win-linux:` variants and the `[data-shell]` token overrides moved into the entry file's `@layer base`. Move the rules for runtime-generated HTML (syntax spans, Markdown, Mermaid, diff gutters, scrollbars, keyframes) into `@layer components` in `web/tailwind.css`. Delete `web/style.css`, `web/workbench.css`, `web/desktop.css`. Update `docs/internals/styling-and-themes.md` to describe the final system.

### Phase 7: Audit and fix

A separate agent audits the finished UI with the impeccable audit, critique and polish playbooks (Operate mode): accessibility, performance, theming, responsive layout, implementation integrity, and usability heuristics on the real screens. It runs the bundled detector against the running app, fixes every P0, P1 and P2 finding, re-runs the audit, and reports scores before and after.

## Verification per phase

- `node scripts/build-web.js && node scripts/check-web.js && bun test web/src/ && go test ./... && npm test --prefix desktop`
- `grep -rnE "#[0-9a-fA-F]{3,8}\b|rgba?\(|oklch\(" web/tailwind.css web/src web/*.html` finds no colour literals outside SVG data.
- Screenshots of the editor, command palette, settings, git changes, inspector, search and the tree context menu in both themes, compared with the previous phase.
