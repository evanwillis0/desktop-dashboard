"""Canvas assignments from your private calendar feed (iCal).

Try it from the backend/ folder:
    ../.venv/bin/python -m dashboard.sources.canvas
"""

import re
from dataclasses import asdict, dataclass
from datetime import date, datetime, time

import httpx
import icalendar

from dashboard.secrets import get_secret

# "Homework 3 [CMSC250]" -> title "Homework 3", course "CMSC250"
SUMMARY_PATTERN = re.compile(r"^(?P<title>.*?)\s*\[(?P<course>[^\]]+)\]\s*$")
# "...include_contexts=course_123...#assignment_456" -> course id 123, assignment id 456
URL_PATTERN = re.compile(r"course_(?P<course_id>\d+).*#assignment_(?P<assignment_id>\d+)")


@dataclass
class Assignment:
    title: str
    course: str
    due: datetime  # in your Mac's local time zone
    all_day: bool  # True when Canvas only gave a date (no exact time)
    url: str  # direct link to the assignment page

    def to_dict(self) -> dict:
        data = asdict(self)
        data["due"] = self.due.isoformat()
        return data


def parse_feed(ics_text: str, base_url: str) -> list[Assignment]:
    """Turn the raw feed into a list of assignments sorted by due date."""
    calendar = icalendar.Calendar.from_ical(ics_text)
    assignments = []

    for event in calendar.walk("VEVENT"):
        # The feed can also hold regular calendar events; we only want assignments.
        if not str(event.get("UID", "")).startswith("event-assignment-"):
            continue

        summary = str(event.get("SUMMARY", "")).strip()
        match = SUMMARY_PATTERN.match(summary)
        title, course = (match["title"], match["course"]) if match else (summary, "Other")

        start = event.decoded("DTSTART")
        if isinstance(start, datetime):
            due, all_day = start.astimezone(), False
        else:
            # Date-only: treat as due at the very end of that day.
            due, all_day = datetime.combine(start, time(23, 59)).astimezone(), True

        calendar_url = str(event.get("URL", ""))
        ids = URL_PATTERN.search(calendar_url)
        url = (f"{base_url}/courses/{ids['course_id']}/assignments/{ids['assignment_id']}"
               if ids else calendar_url)

        assignments.append(Assignment(title, course, due, all_day, url))

    return sorted(assignments, key=lambda a: a.due)


def fetch_assignments() -> list[Assignment]:
    """Download the feed using the link saved by setup_canvas, then parse it."""
    feed_url = get_secret("canvas_feed_url")
    base_url = get_secret("canvas_url")
    if not feed_url or not base_url:
        raise RuntimeError("Canvas isn't set up. Run: ../.venv/bin/python -m dashboard.setup_canvas")

    response = httpx.get(feed_url, timeout=20, follow_redirects=True)
    response.raise_for_status()
    return parse_feed(response.text, base_url)


def upcoming(assignments: list[Assignment], now: datetime | None = None) -> list[Assignment]:
    """Only assignments that are not yet due."""
    now = now or datetime.now().astimezone()
    return [a for a in assignments if a.due >= now]


def format_due(a: Assignment, today: date | None = None) -> str:
    """'Mon Nov 24' for date-only, 'Sun Nov 23, 11:30 PM' otherwise, plus 'in N days'."""
    today = today or date.today()
    label = a.due.strftime("%a %b %-d") if a.all_day else a.due.strftime("%a %b %-d, %-I:%M %p")
    days = (a.due.date() - today).days
    when = "today" if days == 0 else "tomorrow" if days == 1 else f"in {days} days"
    return f"{label} ({when})"


def main() -> None:
    items = upcoming(fetch_assignments())
    if not items:
        print("Nothing upcoming on Canvas.")
        return

    by_course: dict[str, list[Assignment]] = {}
    for a in items:
        by_course.setdefault(a.course, []).append(a)

    print(f"Upcoming Canvas assignments ({len(items)})\n")
    for course, course_items in by_course.items():
        print(course)
        for a in course_items:
            print(f"  • {a.title:<32} {format_due(a)}")
        print()


if __name__ == "__main__":
    main()
