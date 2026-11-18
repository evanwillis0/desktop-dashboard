"""Log in once to a site so the dashboard can read it. Run from the backend/ folder:

    ../.venv/bin/python -m dashboard.setup_login gradescope
    ../.venv/bin/python -m dashboard.setup_login piazza
    ../.venv/bin/python -m dashboard.setup_login canvas

A separate Chrome window opens (its own profile in data/browser-profile, isolated from
your normal Chrome). Log in the way you normally do (school login, Duo, password). As
soon as the site shows you're logged in, the cookies are saved to the Keychain and the
window closes. Nothing you type is seen or stored by this script.
"""

import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urljoin, urlparse

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
    # A normal page, not the API: Canvas can refuse API calls that come with a browser login.
    "canvas": Site("https://umd.instructure.com/", "umd.instructure.com", "https://umd.instructure.com/profile"),
}


_last_probe_answer: dict[str, str] = {}


def probe_logged_in(browser, site: Site) -> bool:
    """Ask the site itself, using the browser window's cookies, whether we're logged in.

    No redirects are followed. A logged-out visitor is refused (401/403) or sent to a login
    page; a logged-in one gets the page (200) or is sent somewhere else on the same site
    (Canvas, for one, may forward /profile to /profile/settings).
    """
    try:
        response = browser.request.get(site.probe_url, max_redirects=0, timeout=10_000)
    except Exception:  # network hiccup mid-login; just try again next round
        return False
    status = response.status
    target = urljoin(site.probe_url, response.headers.get("location", "")) if 300 <= status < 400 else ""
    target_host, target_path = urlparse(target).hostname or "", urlparse(target).path or ""

    # Note each new answer (status and page path only, never the query, which can hold tokens),
    # so a login that isn't noticed can be explained from the log.
    answer = f"HTTP {status}" + (f" -> {target_host}{target_path}" if target else "")
    if _last_probe_answer.get(site.host) != answer:
        _last_probe_answer[site.host] = answer
        print(f"Login check: {answer}", flush=True)

    if status == 200:
        return True
    if target:
        return target_host == site.host and not any(word in target_path.lower() for word in ("login", "sso", "saml"))
    return False


def login_chrome_pid() -> int | None:
    """The main process of the Chrome running our profile (not your everyday Chrome)."""
    result = subprocess.run(["ps", "-axo", "pid=,command="], capture_output=True, text=True)
    for line in result.stdout.splitlines():
        pid, _, command = line.strip().partition(" ")
        if f"--user-data-dir={PROFILE_DIR}" in command and "--type=" not in command:
            return int(pid)
    return None


# Asks macOS to bring one app (by process id) to the front. Uses AppKit directly, which,
# unlike System Events, needs no Accessibility permission.
ACTIVATE_JXA = """
ObjC.import("AppKit");
function run(argv) {
  const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(Number(argv[0]));
  if (app.isNil()) return "not found";
  app.activateWithOptions($.NSApplicationActivateAllWindows | $.NSApplicationActivateIgnoringOtherApps);
  delay(0.5);
  const front = $.NSWorkspace.sharedWorkspace.frontmostApplication;
  return front.processIdentifier == Number(argv[0]) ? "in front" : "macOS kept another app in front";
}
"""


def bring_to_front() -> str:
    """Bring the login window in front of your other windows.

    When the dashboard server opens it (the widget's "Log in again" link), Chrome starts
    from a background program, and macOS doesn't raise its window by itself.
    """
    pid = login_chrome_pid()
    if not pid:
        return "Login window: couldn't find it to bring forward."
    result = subprocess.run(["osascript", "-l", "JavaScript", "-e", ACTIVATE_JXA, str(pid)],
                            capture_output=True, text=True, timeout=10)
    return f"Login window: {(result.stdout or result.stderr).strip() or 'no answer'}."


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
        closed = []  # set when Chrome goes away (window closed or Chrome quit)
        browser.on("close", lambda _: closed.append(True))
        page = browser.pages[0] if browser.pages else browser.new_page()
        page.goto(site.start_url)
        print(bring_to_front())

        deadline = time.time() + TIMEOUT_SECONDS
        last_urls, last_pages = None, None
        while time.time() < deadline:
            if closed or not browser.pages:  # you closed the window or quit Chrome
                print("The login window was closed before login finished. Nothing was saved.")
                return
            # Note where the window is (host and path only; the rest can hold tokens). The same
            # page moving on (e.g. the school login after you submit) shows as "next step".
            urls = [tab.url for tab in browser.pages]
            if urls != last_urls:
                pages = ", ".join(f"{urlparse(u).hostname}{urlparse(u).path}" for u in urls)
                print(f"Window is on: {pages}" + (" (next step)" if pages == last_pages else ""), flush=True)
                last_urls, last_pages = urls, pages
            # Only ask once you're back on the site (not while on the school login page).
            on_site = any(urlparse(u).hostname == site.host for u in urls)
            if on_site and probe_logged_in(browser, site):
                break
            # Wait through Playwright, not time.sleep: Playwright only learns what the window
            # did (moved to Canvas, got closed) while it's being called. With a plain sleep,
            # the window's address never updated here, so a finished login went unnoticed.
            try:
                browser.pages[0].wait_for_timeout(2000)
            except Exception:  # that tab closed mid-wait; the next round sees what's left
                time.sleep(0.5)
        else:
            browser.close()
            print("Timed out after 5 minutes without finishing login. Nothing was saved.")
            return

        page.wait_for_timeout(2000) if not page.is_closed() else time.sleep(2)  # let the site finish setting cookies
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
