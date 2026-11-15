"""Gradescope: every assignment in your current-term courses, with status, due dates and scores.

Gradescope has no API, so this reads the same pages you see, using the cookies saved by
`setup_login gradescope`. Only the current term (the first one on your account page) is
read, so next semester's courses appear automatically.

New assignments are detected by remembering what was there last time (data/gradescope_seen.json).

Try it from the backend/ folder:
    ../.venv/bin/python -m dashboard.sources.gradescope
"""

import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from bs4 import BeautifulSoup

from dashboard.sessions import SessionExpired, session_client

BASE = "https://www.gradescope.com"
SEEN_FILE = Path(__file__).resolve().parents[3] / "data" / "gradescope_seen.json"
NEW_FOR = timedelta(hours=48)
INITIAL = "initial"  # first_seen marker for assignments that existed before the dashboard did


def get_page(client, path: str) -> BeautifulSoup:
    response = client.get(BASE + path)
    if response.status_code == 401 or "/login" in response.url.path:
        raise SessionExpired("gradescope")
    response.raise_for_status()
    return BeautifulSoup(response.text, "html.parser")


def parse_time(tag) -> str | None:
    """'2026-09-05 23:59:00 -0400' -> ISO 8601."""
    if not tag or not tag.get("datetime"):
        return None
    return datetime.strptime(tag["datetime"], "%Y-%m-%d %H:%M:%S %z").isoformat()


def parse_status(row) -> dict:
    score = row.select_one(".submissionStatus--score")
    if score:
        text = score.get_text(strip=True)  # "19.0 / 20.0"
        numbers = re.findall(r"[\d.]+", text)
        earned, total = (float(numbers[0]), float(numbers[1])) if len(numbers) == 2 else (None, None)
        return {"status": "graded", "score": text, "earned": earned, "total": total}
    text = row.select_one(".submissionStatus--text")
    label = text.get_text(strip=True) if text else ""
    return {"status": "submitted" if label == "Submitted" else "not_submitted", "score": None,
            "earned": None, "total": None}


def parse_course(page: BeautifulSoup, course_id: str, course_name: str) -> list[dict]:
    course_url = f"{BASE}/courses/{course_id}"
    assignments = []
    for row in page.select("#assignments-student-table tbody tr"):
        cell = row.find("th")
        if not cell:
            continue
        link = cell.find("a")
        button = cell.find("button")
        if link:  # you've submitted: link goes to your submission
            title = link.get_text(strip=True)
            match = re.search(r"/assignments/(\d+)", link.get("href", ""))
            assignment_id = match.group(1) if match else title
            url = BASE + link["href"]
        elif button:  # still open, not submitted yet
            title = button.get("data-assignment-title") or button.get_text(strip=True)
            assignment_id = button.get("data-assignment-id") or title
            url = f"{course_url}/assignments/{assignment_id}"
        else:  # closed with no submission
            title = cell.get_text(strip=True)
            assignment_id = title
            url = course_url

        due_dates = row.select("time.submissionTimeChart--dueDate")
        assignments.append({
            "key": f"{course_id}:{assignment_id}",
            "title": title,
            "course": course_name,
            "url": url,
            "released_at": parse_time(row.select_one("time.submissionTimeChart--releaseDate")),
            "due_at": parse_time(due_dates[0]) if due_dates else None,
            "late_due_at": parse_time(due_dates[1]) if len(due_dates) > 1 else None,
            **parse_status(row),
        })
    return assignments


def _recent(stamp: str | None, now: datetime) -> bool:
    return stamp not in (None, INITIAL) and now - datetime.fromisoformat(stamp) < NEW_FOR


def mark_changes(assignments: list[dict], now: datetime) -> None:
    """Gradescope doesn't say when things appear or get graded, so remember it ourselves.

    For each assignment we store when we first saw it and when we first saw a score.
    Anything already there on the very first run is marked INITIAL (never "new").
    Adds is_new, newly_graded and graded_seen to each assignment.
    """
    first_run = not SEEN_FILE.exists()
    seen = {} if first_run else json.loads(SEEN_FILE.read_text())
    stamp = INITIAL if first_run else now.isoformat()
    for a in assignments:
        entry = seen.setdefault(a["key"], {"first_seen": stamp, "graded_seen": None})
        if a["status"] == "graded" and entry["graded_seen"] is None:
            entry["graded_seen"] = stamp
        a["is_new"] = _recent(entry["first_seen"], now)
        a["newly_graded"] = _recent(entry["graded_seen"], now)
        a["graded_seen"] = entry["graded_seen"] if entry["graded_seen"] != INITIAL else None
    SEEN_FILE.parent.mkdir(exist_ok=True)
    SEEN_FILE.write_text(json.dumps(seen, indent=1))


def is_open(a: dict, now: datetime) -> bool:
    """Still accepting submissions (before the late due date if there is one).

    Undated items are in-class quizzes/exams scanned in by instructors: never "open".
    """
    final = a["late_due_at"] or a["due_at"]
    return final is not None and datetime.fromisoformat(final) > now


def fetch() -> dict:
    now = datetime.now(timezone.utc)
    with session_client("gradescope") as client:
        account = get_page(client, "/account")
        terms = account.select(".courseList--term")
        groups = account.select(".courseList--coursesForTerm")
        if not groups:
            return {"term": None, "courses": [], "assignments": []}

        term = terms[0].get_text(strip=True) if terms else ""
        courses, assignments = [], []
        for box in groups[0].select("a.courseBox"):
            course_id = box["href"].rstrip("/").split("/")[-1]
            short = box.select_one(".courseBox--shortname")
            name = short.get_text(strip=True) if short else course_id
            courses.append({"name": name, "url": f"{BASE}/courses/{course_id}"})
            assignments += parse_course(get_page(client, f"/courses/{course_id}"), course_id, name)

    mark_changes(assignments, now)
    for a in assignments:
        a["open"] = is_open(a, now)
    return {"term": term, "courses": courses, "assignments": assignments}


def main() -> None:
    data = fetch()
    open_items = sorted((a for a in data["assignments"] if a["open"]), key=lambda a: a["due_at"] or "")
    print(f"{data['term']}: {len(data['courses'])} courses, {len(data['assignments'])} assignments\n")
    print("Open now:")
    for a in open_items:
        print(f"  {'NEW ' if a['is_new'] else ''}{a['course']}: {a['title']}  due {a['due_at']}  [{a['status']}]")


if __name__ == "__main__":
    main()
