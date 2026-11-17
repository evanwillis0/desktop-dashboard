"""Local server the desktop widget reads from.

Every source (Canvas for now; GitHub, Gmail, ... later) is refreshed on its own
timer in the background. The latest result is kept in memory, saved to
data/cache.json so it survives restarts, and served as JSON.

Run from the backend/ folder:
    ../.venv/bin/python -m dashboard.server

Then open http://127.0.0.1:8787/api/all
"""

import asyncio
import json
import logging
import sys
from collections.abc import Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from dashboard.sources import canvas, canvas_grades, github, gmail, google_calendar, gradescope, piazza

HOST = "127.0.0.1"  # only reachable from this Mac
PORT = 8787
CACHE_FILE = Path(__file__).resolve().parents[2] / "data" / "cache.json"
# Übersicht widgets run in a web view served from this address.
WIDGET_ORIGINS = ["http://127.0.0.1:41416", "http://localhost:41416"]

# Log through uvicorn's logger so messages show however the server is started.
log = logging.getLogger("uvicorn.error")


@dataclass
class Source:
    fetch: Callable[[], dict]  # returns the data to show; raises on failure
    every_minutes: int  # how often to refresh


def fetch_canvas() -> dict:
    """Due dates from the calendar feed, plus grades and scores from the Canvas login.

    The two are independent: if the login has expired, due dates still show and only
    the grades part reports the problem (scores_error).
    """
    items = canvas.upcoming(canvas.fetch_assignments())
    data = {"assignments": [a.to_dict() for a in items], "grades": {}, "scores": [], "scores_error": None}
    try:
        data.update(canvas_grades.fetch())
    except Exception as error:  # noqa: BLE001
        data["scores_error"] = safe_error(error)
    return data


SOURCES: dict[str, Source] = {
    "canvas": Source(fetch=fetch_canvas, every_minutes=15),
    "github": Source(fetch=github.fetch, every_minutes=5),
    "gmail": Source(fetch=gmail.fetch, every_minutes=5),
    "calendar": Source(fetch=google_calendar.fetch, every_minutes=10),
    "gradescope": Source(fetch=gradescope.fetch, every_minutes=10),
    "piazza": Source(fetch=piazza.fetch, every_minutes=5),
}

# Latest result per source:
# {"status": "pending" | "ok" | "error", "updated_at": str | None, "error": str | None, "data": dict | None}
state: dict[str, dict] = {
    name: {"status": "pending", "updated_at": None, "error": None, "data": None} for name in SOURCES
}


def safe_error(error: Exception) -> str:
    """A short error message that never includes URLs (feed links are private)."""
    if isinstance(error, httpx.HTTPStatusError):
        return f"HTTP {error.response.status_code} from service"
    if isinstance(error, httpx.HTTPError):
        return f"Network problem ({type(error).__name__})"
    return str(error) or type(error).__name__


def load_cache() -> None:
    """Start with the last saved results so the widget has something to show right away."""
    if not CACHE_FILE.exists():
        return
    try:
        saved = json.loads(CACHE_FILE.read_text())
    except (OSError, json.JSONDecodeError):
        log.warning("Ignoring unreadable cache file")
        return
    for name, entry in saved.items():
        if name in state:
            state[name] = entry


def save_cache() -> None:
    """Write to a temp file and rename it, so a crash never leaves a half-written cache."""
    CACHE_FILE.parent.mkdir(exist_ok=True)
    temp = CACHE_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(state, indent=2))
    temp.replace(CACHE_FILE)


async def refresh(name: str) -> None:
    """Fetch one source. On failure, keep the last good data and record the error."""
    try:
        # Fetchers use normal (blocking) code, so run them in a worker thread.
        data = await asyncio.to_thread(SOURCES[name].fetch)
        state[name] = {"status": "ok", "updated_at": now_iso(), "error": None, "data": data}
        log.info("Refreshed %s", name)
    except Exception as error:  # noqa: BLE001  one broken source must not stop the others
        state[name] = {**state[name], "status": "error", "error": safe_error(error)}
        log.warning("Refreshing %s failed: %s", name, safe_error(error))
    save_cache()


async def refresh_forever(name: str) -> None:
    while True:
        await refresh(name)
        await asyncio.sleep(SOURCES[name].every_minutes * 60)


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_cache()
    tasks = [asyncio.create_task(refresh_forever(name)) for name in SOURCES]
    yield
    for task in tasks:
        task.cancel()


app = FastAPI(title="desktop-dashboard", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=WIDGET_ORIGINS, allow_methods=["GET", "POST"])


@app.get("/api/all")
def get_all() -> dict:
    """Everything at once. This is what the widget calls."""
    return state


# ----- Notepad -----
# Your notes from the widget's notepad, kept in data/ (never committed). The widget sends the
# whole text as plain text, which (unlike JSON) needs no extra CORS permission check.

NOTES_FILE = CACHE_FILE.parent / "notes.json"
MAX_NOTE_CHARS = 100_000


@app.get("/api/notes")
def get_notes() -> dict:
    if not NOTES_FILE.exists():
        return {"text": "", "updated_at": None}
    try:
        return json.loads(NOTES_FILE.read_text())
    except (OSError, json.JSONDecodeError):
        log.warning("Notes file unreadable; starting with empty notes")
        return {"text": "", "updated_at": None}


@app.post("/api/notes")
async def save_notes(request: Request) -> dict:
    text = (await request.body()).decode("utf-8", errors="replace")
    if len(text) > MAX_NOTE_CHARS:
        raise HTTPException(413, f"Notes are limited to {MAX_NOTE_CHARS:,} characters")
    saved = {"text": text, "updated_at": now_iso()}
    # Write a temp file and rename it, so a crash never leaves half-written notes.
    NOTES_FILE.parent.mkdir(exist_ok=True)
    temp = NOTES_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(saved))
    temp.replace(NOTES_FILE)
    return {"updated_at": saved["updated_at"]}


# ----- "Log in again" from the widget -----
# Clicking a "Logged out" warning asks the server to open the same login window as
# `setup_login <site>`. When you finish (or close it), that source is refreshed right away.

LOGIN_SITES = {"canvas", "gradescope", "piazza"}  # same names as setup_login.SITES and SOURCES
BACKEND_DIR = Path(__file__).resolve().parents[1]
login_tasks: dict[str, asyncio.Task] = {}


async def run_login(site: str) -> None:
    process = await asyncio.create_subprocess_exec(
        sys.executable, "-m", "dashboard.setup_login", site,
        cwd=BACKEND_DIR, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
    )
    output, _ = await process.communicate()
    lines = output.decode(errors="replace").strip().splitlines()
    log.info("Login window for %s finished: %s", site, lines[-1] if lines else "(no output)")
    await refresh(site)


@app.post("/api/login/{site}")
async def start_login(site: str, request: Request) -> dict:
    # Only the dashboard widget may ask (a browser always says which page a request comes from).
    if request.headers.get("origin") not in WIDGET_ORIGINS:
        raise HTTPException(403, "Only the dashboard widget can open a login window")
    if site not in LOGIN_SITES:
        raise HTTPException(404, f"Unknown site '{site}'")
    running = login_tasks.get(site)
    if running and not running.done():
        return {"status": "already_open"}
    login_tasks[site] = asyncio.create_task(run_login(site))
    log.info("Opening login window for %s", site)
    return {"status": "opened"}


# (Must come after /api/notes, or "notes" would be treated as a source name.)
@app.get("/api/{name}")
def get_source(name: str) -> dict:
    if name not in state:
        raise HTTPException(404, f"Unknown source '{name}'")
    return state[name]


@app.post("/api/refresh")
async def refresh_all() -> dict:
    """Refresh every source now (for a refresh button on the widget)."""
    await asyncio.gather(*(refresh(name) for name in SOURCES))
    return state


def main() -> None:
    uvicorn.run(app, host=HOST, port=PORT)


if __name__ == "__main__":
    main()
