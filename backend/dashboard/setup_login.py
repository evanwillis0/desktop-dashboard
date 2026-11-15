"""Log in once to a site so the dashboard can read it. Run from the backend/ folder:

    ../.venv/bin/python -m dashboard.setup_login gradescope
    ../.venv/bin/python -m dashboard.setup_login piazza
    ../.venv/bin/python -m dashboard.setup_login canvas

A separate Chrome window opens (its own profile in data/browser-profile, isolated from
your normal Chrome). Log in the way you normally do (school login, Duo, password). As
soon as the site shows you're logged in, the cookies are saved to the Keychain and the
window closes. Nothing you type is seen or stored by this script.
"""

import sys
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

from dashboard.sessions import save_cookies

PROFILE_DIR = Path(__file__).resolve().parents[2] / "data" / "browser-profile"
TIMEOUT_SECONDS = 5 * 60


@dataclass
class Site:
    start_url: str  # where the login begins
    host: str  # the site's own address (cookies for it are saved)
    probe_url: str  # a page that answers 200 only when you're logged in (otherwise it redirects or refuses)


SITES = {
    "gradescope": Site("https://www.gradescope.com/login", "www.gradescope.com", "https://www.gradescope.com/account"),
    "piazza": Site("https://piazza.com/account/login", "piazza.com", "https://piazza.com/class"),
    "canvas": Site("https://umd.instructure.com/", "umd.instructure.com", "https://umd.instructure.com/api/v1/users/self"),
}


def probe_logged_in(browser, site: Site) -> bool:
    """Ask the site itself, using the browser window's cookies, whether we're logged in.

    No redirects are followed: a logged-out visitor gets sent to a login page (3xx)
    or refused (401/403), while a logged-in one gets the page (200).
    """
    try:
        response = browser.request.get(site.probe_url, max_redirects=0, timeout=10_000)
    except Exception:  # network hiccup mid-login; just try again next round
        return False
    return response.status == 200


def log_in(name: str) -> None:
    site = SITES[name]
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Opening Chrome for {name}. Log in there; this window closes by itself when you're done.")

    with sync_playwright() as p:
        browser = p.chromium.launch_persistent_context(
            str(PROFILE_DIR),
            channel="chrome",  # use your installed Google Chrome (no extra download)
            headless=False,
            no_viewport=True,
        )
        page = browser.pages[0] if browser.pages else browser.new_page()
        page.goto(site.start_url)

        deadline = time.time() + TIMEOUT_SECONDS
        while time.time() < deadline:
            if not browser.pages:  # you closed the window
                print("The login window was closed before login finished. Nothing was saved.")
                return
            # Only ask once you're back on the site (not while on the school login page).
            on_site = any(urlparse(tab.url).hostname == site.host for tab in browser.pages)
            if on_site and probe_logged_in(browser, site):
                break
            time.sleep(2)
        else:
            browser.close()
            print("Timed out after 5 minutes without finishing login. Nothing was saved.")
            return

        time.sleep(2)  # let the site finish setting its cookies
        domain = site.host.removeprefix("www.")
        cookies = [c for c in browser.cookies() if c["domain"].lstrip(".").endswith(domain)]
        browser.close()

    save_cookies(name, cookies)
    print(f"Logged in to {name}. Saved {len(cookies)} cookies to the Keychain.")


def main() -> None:
    if len(sys.argv) == 2 and sys.argv[1] in SITES:
        log_in(sys.argv[1])
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
