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
from collections.abc import Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from dashboard.sources import canvas, github, gmail, google_calendar, gradescope

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
    items = canvas.upcoming(canvas.fetch_assignments())
    return {"assignments": [a.to_dict() for a in items]}


SOURCES: dict[str, Source] = {
    "canvas": Source(fetch=fetch_canvas, every_minutes=15),
    "github": Source(fetch=github.fetch, every_minutes=5),
    "gmail": Source(fetch=gmail.fetch, every_minutes=5),
    "calendar": Source(fetch=google_calendar.fetch, every_minutes=10),
    "gradescope": Source(fetch=gradescope.fetch, every_minutes=10),
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
