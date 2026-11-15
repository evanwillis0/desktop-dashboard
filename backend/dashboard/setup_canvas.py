"""One-time setup: save your private Canvas calendar feed link to the Keychain.

Find the link in Canvas: Calendar -> "Calendar Feed" (bottom right) -> copy the URL.

Run from the backend/ folder:
    ../.venv/bin/python -m dashboard.setup_canvas

The link is typed with hidden input (anyone who has it can see your assignments)
and is only saved after it downloads as a real calendar.
"""

import re
from getpass import getpass
from urllib.parse import urlparse

import httpx

from dashboard.secrets import set_secret


def clean_pasted_link(raw: str) -> str:
    """Keep only the first https://....ics link.

    Hidden input means you can't see a double paste, so
    'https://a/x.icshttps://a/x.ics' becomes 'https://a/x.ics'.
    """
    match = re.search(r"https?://.+?\.ics", raw.strip())
    return match.group(0) if match else raw.strip()


def base_url_from_feed(feed_url: str) -> str:
    """'https://school.instructure.com/feeds/calendars/user_x.ics' -> 'https://school.instructure.com'."""
    parsed = urlparse(feed_url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError("The link should start with https://")
    if "/feeds/calendars/" not in parsed.path:
        raise ValueError("That isn't a Canvas calendar feed link (it should contain /feeds/calendars/).")
    return f"https://{parsed.netloc}"


def count_events(ics_text: str) -> int:
    """Check the download is an iCalendar file and return how many events it has."""
    if not ics_text.lstrip().startswith("BEGIN:VCALENDAR"):
        raise ValueError("The link didn't return a calendar. Check you copied the whole URL.")
    return ics_text.count("BEGIN:VEVENT")


def main() -> None:
    print("Canvas calendar feed setup for desktop-dashboard\n")

    feed_url = clean_pasted_link(getpass("Paste your Canvas calendar feed link (input is hidden): "))
    if not feed_url:
        print("Nothing entered. Nothing was saved.")
        return

    # Error messages never include the link itself, since it's private.
    try:
        base_url = base_url_from_feed(feed_url)
        print("Downloading the feed to check it...")
        response = httpx.get(feed_url, timeout=20, follow_redirects=True)
        response.raise_for_status()
        events = count_events(response.text)
    except ValueError as error:
        print(f"Couldn't use that link: {error}\nNothing was saved.")
        return
    except httpx.HTTPStatusError as error:
        print(f"Canvas answered with error {error.response.status_code}. "
              "Check you copied the whole link.\nNothing was saved.")
        return
    except httpx.HTTPError as error:
        print(f"Couldn't reach Canvas ({type(error).__name__}). Check your internet.\nNothing was saved.")
        return

    set_secret("canvas_feed_url", feed_url)
    set_secret("canvas_url", base_url)
    print(f"Feed works: {events} events found on {base_url}.")
    print("Saved to the Keychain under 'desktop-dashboard'.")


if __name__ == "__main__":
    main()
