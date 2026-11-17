# Review Workbench

Running `faah` with no arguments opens the **workbench**: one page for opening any directory on the machine or any pull request, and for getting back to what you opened before.

---

## Opening things

- **Type a path or paste a PR URL** into the box at the top and press Enter. Paths may be absolute, relative to the directory faah was started in, or start with `~`. A path to a file opens its repository.
- **Folder completion.** As you type a path, folders whose names start with what you typed (ignoring case) are listed below the box. Each row shows the folder name, a repository or folder icon, and the folder it sits in. Press **Tab** (or click) to complete into the highlighted folder and list what is inside it, **↑/↓** to choose, **Enter** to open, **Esc** to dismiss. Hidden folders are listed once you type the leading dot.
- **Browse** shows two panes: the current folder on the left and, on the right, the folders inside the one you select. The path bar above lists every level; click one to jump back. Click a folder to select it, double-click it (or click its arrow, or press **→** or **Enter**) to go inside, and press **←** to go up. **Open** opens the selected folder, or the current one when nothing is selected. The eye button shows hidden folders and the folder button makes a new one.
- **Recent** lists every directory and pull request opened before, in two sections, **Pull requests** and **Folders**, newest first, including ones opened directly with `faah <dir>` or `faah <pr-url>`. Click a row to reopen it; Cmd/Ctrl-click opens it in a new tab.

Each workspace opens at its own address, `/w/<id>/`, on the workbench's port. The address is stable, so a bookmarked or reloaded review simply reopens. The ▦ button in the explorer header leads back to the workbench.

## Managing the list

Hover a row (or move keyboard focus into it) for its actions:

| Action | Effect |
| :--- | :--- |
| Pin | Pin to the top of its section, or unpin. A pinned row keeps a filled pin. Pinned entries are never dropped. |
| ✕ | Stop the workspace and remove it from the list. |

While a workspace starts, its row shows the progress; if it fails, the row shows the error. Up to 50 unpinned entries are kept. A workspace with no open tab for 30 minutes stops on its own (see Resources).

---

## Keyboard Shortcuts & Controls

| Shortcut / Control | Context | Action |
| :--- | :--- | :--- |
| `/` | Workbench Page | Focus the path / PR URL input box |
| `Tab` | Path Input | Complete into the highlighted folder suggestion |
| `↑` / `↓` | Path Suggestions | Navigate up / down through folder suggestions |
| `Enter` | Path Input / Suggestion | Open the entered folder, PR URL, or highlighted suggestion |
| `Esc` | Path Suggestions | Dismiss folder suggestions |
| `Cmd/Ctrl + Click` | Recent | Open workspace in a new browser tab |
| Pin | Recent row | Pin to the top of its section, or unpin |
| `✕` | Recent row | Stop workspace and remove from list |
| `↑` / `↓` | Browse | Select a folder; the right pane previews it |
| `→` / `Enter` / double-click | Browse | Go into the selected folder |
| `←` | Browse | Go up one folder |
| `Cmd/Ctrl + Enter` | Browse | Open the selected folder, or the current one |
| `▦` | Workspace Header | Return to the Review Workbench from any open workspace |
| Theme button | Status bar | Switch between System, Light and Dark |

## Pull requests

A pull request always opens as a `git worktree` of a local clone of its repository: a separate checkout that shares the clone's history, so opening a PR costs a checkout and never a fresh clone. The PR is checked out again each time it is opened, so it is always current, and the worktree is removed when the workspace stops. Your clone's own branch and working tree are not touched. Unsubmitted review drafts are kept across reopenings.

The first time you open a PR of a repository, faah finds the clone:

1. a clone you used for that repository before;
2. one of your recent folders, or the folder faah was started in;
3. a quick scan (a few levels deep, at most 1.5 seconds) of the usual code folders in your home directory (`~/workspace`, `~/code`, `~/src`, `~/projects`, `~/dev`, `~/repos`, `~/go/src/github.com`, ...) and the folders around your recent ones.

A clone matches when any of its remotes (`origin`, `upstream` for a fork, or another) points at the PR's repository. The clone is remembered, so every later PR of that repository opens straight away.

If no clone is found, the page asks. You can **use your clone**: type its path (with folder completion) or browse to it and press **Use as clone**. Or you can **let faah clone it**: faah makes one partial clone under `~/.faah/repos/<owner>/<repo>`, without a checkout of its own, and reuses it for every later PR of that repository.

A plain `faah <pr-url>` run outside the repository uses the remembered clone too.

If a pull request cannot be opened (a typo in the URL, no access), the page explains why and the entry is left out of the list.

## Status bar and themes

The bottom bar shows the number of running workspaces, the process metrics button (a pulse icon), a link to the source repository and the theme button. Click the metrics button for memory and CPU of the workbench and every running workspace added together, with a breakdown by process. The theme button switches between System, Light and Dark on each click; the choice is saved to settings, so the workspaces use it too.

## Resources

Every workspace runs as its own faah process with its own index and language servers. A workspace that has had no open tab for 30 minutes is stopped to free its memory; it restarts the next time it is opened. Stopping the workbench (Ctrl-C) stops every workspace and removes their PR checkouts.

Running `faah` again while a workbench is already running opens the existing one instead of starting a second.

## Security

The workbench can list and open **any directory the faah process can read**. On the default `-host 127.0.0.1` that is only you. With `-host 0.0.0.0`, anyone who can reach the address can browse the machine's folders and open any of them for reading and editing, and faah prints a warning saying so. Expose it only over networks you trust. The same DNS rebinding and same-origin checks as the rest of faah apply.

## Where state lives

What you opened, and which clone each repository's PRs use, is saved in `$XDG_STATE_HOME/faah/workbench.json`, falling back to `~/.faah/workbench.json`. Clones faah makes live in `repos/` beside it. Nothing is written inside your repositories, apart from the temporary worktree registrations and `refs/faah/*` refs that faah already uses for PR review and removes on exit.

## Flags

The workbench passes `-no-lsp`, `-no-git`, `-no-agent`, `-no-telemetry` and `-agent` on to every workspace it opens. `-host`, `-port`, `-base-path` and `-no-open` apply to the workbench itself. To open the current directory directly, as before, run `faah .`.
