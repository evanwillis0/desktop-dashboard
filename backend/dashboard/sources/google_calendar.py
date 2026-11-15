"""Google Calendar: the next 7 days of events from the UMD account and every calendar linked to it.

"Linked" = everything in that account's calendar list that's switched on (selected) in
Google Calendar, so hiding a calendar there hides it here too. Read-only.

Try it from the backend/ folder:
    ../.venv/bin/python -m dashboard.sources.google_calendar
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import httpx

from dashboard.google_auth import account_email, load_credentials

API = "https://www.googleapis.com/calendar/v3"
ACCOUNT = "umd"  # the only account whose calendars are shown
DAYS_AHEAD = 7


def calendars(client: httpx.Client) -> list[dict]:
    response = client.get("/users/me/calendarList")
    response.raise_for_status()
    return [c for c in response.json().get("items", []) if c.get("selected") and not c.get("hidden")]


def declined(event: dict) -> bool:
    return any(a.get("self") and a.get("responseStatus") == "declined" for a in event.get("attendees", []))


def parse_event(event: dict, calendar: dict, email: str | None) -> dict:
    start, end = event["start"], event["end"]
    all_day = "date" in start
    link = event.get("htmlLink", "")
    if link and email:
        link += f"&authuser={quote(email)}"  # open as the UMD account
    return {
        "title": event.get("summary") or "(no title)",
        "start": start.get("date") or start.get("dateTime"),
        "end": end.get("date") or end.get("dateTime"),
        "all_day": all_day,
        "location": event.get("location"),
        "calendar": calendar.get("summaryOverride") or calendar.get("summary", ""),
        "color": calendar.get("backgroundColor"),
        "url": link,
    }


def fetch() -> dict:
    creds = load_credentials(ACCOUNT)
    email = account_email(ACCOUNT)
    now = datetime.now(timezone.utc)
    params = {
        "timeMin": now.isoformat(),  # events that haven't ended yet (so in-progress ones show)
        "timeMax": (now + timedelta(days=DAYS_AHEAD)).isoformat(),
        "singleEvents": "true",  # expand repeating events (e.g. weekly classes) into each meeting
        "orderBy": "startTime",
        "maxResults": 100,
    }

    with httpx.Client(base_url=API, headers={"Authorization": f"Bearer {creds.token}"}, timeout=20) as client:
        cals = calendars(client)

        def events_for(calendar: dict) -> list[dict]:
            response = client.get(f"/calendars/{quote(calendar['id'], safe='')}/events", params=params)
            response.raise_for_status()
            return [parse_event(e, calendar, email) for e in response.json().get("items", [])
                    if e.get("status") != "cancelled" and not declined(e)]

        with ThreadPoolExecutor(max_workers=6) as pool:
            batches = list(pool.map(events_for, cals))

    events = sorted((e for batch in batches for e in batch), key=lambda e: sort_key(e["start"]))
    return {
        "account": email,
        "calendars": [{"name": c.get("summaryOverride") or c["summary"], "color": c.get("backgroundColor")} for c in cals],
        "events": events,
    }


def sort_key(start: str) -> datetime:
    """All-day events ('2026-11-16') sort at the start of their day, in local time."""
    if len(start) == 10:
        return datetime.fromisoformat(start).astimezone()
    return datetime.fromisoformat(start)


def main() -> None:
    data = fetch()
    print(f"Calendars ({len(data['calendars'])}): {', '.join(c['name'] for c in data['calendars'])}\n")
    for e in data["events"]:
        when = sort_key(e["start"]).strftime("%a %b %-d" if e["all_day"] else "%a %b %-d %-I:%M %p")
        print(f"  {when:<20} {e['title'][:40]:<40} [{e['calendar']}]")


if __name__ == "__main__":
    main()
