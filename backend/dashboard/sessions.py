"""Logged-in web sessions for sites without an API you can use (Gradescope, Piazza, Canvas grades).

You log in once in a real Chrome window (setup_login.py). The site's cookies are saved
in the Keychain, and the background server sends them with its requests, the same way
your browser proves who you are. When a site logs you out, SessionExpired is raised and
the card shows "Log in again".
"""

import json

import httpx

from dashboard.secrets import get_secret, set_secret

SETUP_HINT = "../.venv/bin/python -m dashboard.setup_login"

# A normal browser identity; some sites refuse requests from unknown clients.
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


class SessionExpired(RuntimeError):
    def __init__(self, site: str):
        super().__init__(f"Logged out of {site}. Log in again: {SETUP_HINT} {site}")
        self.site = site


def cookie_key(site: str) -> str:
    return f"cookies_{site}"


def save_cookies(site: str, cookies: list[dict]) -> None:
    """Keep only what's needed to send the cookies back (name, value, domain, path)."""
    slim = [{k: c[k] for k in ("name", "value", "domain", "path")} for c in cookies]
    set_secret(cookie_key(site), json.dumps(slim))


def session_client(site: str, **kwargs) -> httpx.Client:
    """An HTTP client that sends the saved cookies for `site`."""
    raw = get_secret(cookie_key(site))
    if not raw:
        raise SessionExpired(site)
    jar = httpx.Cookies()
    for c in json.loads(raw):
        jar.set(c["name"], c["value"], domain=c["domain"], path=c["path"])
    return httpx.Client(
        cookies=jar,
        headers={"User-Agent": USER_AGENT},
        follow_redirects=True,
        timeout=20,
        **kwargs,
    )
