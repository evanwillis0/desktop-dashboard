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

## Run the server

```bash
cd backend && ../.venv/bin/python -m dashboard.server
```

Then open http://127.0.0.1:8787/api/all. Each source refreshes on its own timer;
`POST /api/refresh` refreshes everything immediately.
