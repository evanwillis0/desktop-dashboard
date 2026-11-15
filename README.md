# desktop-dashboard

A desktop dashboard for macOS that sits behind your windows (via [Übersicht](https://tracesof.net/uebersicht/))
and shows a snapshot of Canvas, Gradescope, Piazza, Google Calendar, three Gmail inboxes, and GitHub.

## How it fits together

```
 services (Canvas, GitHub, ...)
        │  polled every few minutes
        ▼
 backend/  Python server on localhost: fetches, caches to data/, reads secrets from Keychain
        │  JSON over http://127.0.0.1
        ▼
 widget/   Übersicht widget: draws the cards on the desktop
```

## Layout

| Path | Purpose |
|---|---|
| `backend/dashboard/` | Python package for the local server |
| `backend/dashboard/sources/` | One module per service (canvas.py, github.py, ...) |
| `widget/` | The Übersicht widget (HTML/JSX) |
| `data/` | Cached responses. Git-ignored |
| `requirements.txt` | Pinned Python packages |

Secrets (tokens, passwords) are stored in the macOS Keychain, never in this folder.

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd backend && ../.venv/bin/python -m dashboard.setup_canvas
```

## Start at login

```bash
scripts/install_login.sh
```

Installs two launchd agents: the server runs in the background (restarted if it crashes), and at
each login `scripts/at_login.sh` opens Übersicht and hides reopened apps (they stay open; click in
the Dock to bring one back). Logs: `~/Library/Logs/desktop-dashboard/`. Undo with `scripts/uninstall_login.sh`.

## Run the server manually

```bash
cd backend && ../.venv/bin/python -m dashboard.server
```

Then open http://127.0.0.1:8787/api/all. Each source refreshes on its own timer;
`POST /api/refresh` refreshes everything immediately.
