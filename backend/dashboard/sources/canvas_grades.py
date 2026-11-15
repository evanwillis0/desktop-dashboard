"""Canvas grades: each current class's overall score, and your recently graded submissions.

Uses the login saved by `setup_login canvas` (the calendar feed can't provide grades).
Only the current term is read: the most recent real term among your active courses, so
past terms and non-class groups ("Default Term") are skipped.

Try it from the backend/ folder:
    ../.venv/bin/python -m dashboard.sources.canvas_grades
"""

import re
from datetime import datetime, timedelta, timezone

from dashboard.sessions import SessionExpired, session_client

API = "https://umd.instructure.com/api/v1"
RECENT_SCORES = 15  # newest graded submissions kept (the card shows fewer)
FRESH_FOR = timedelta(hours=48)


def get_json(client, path: str, **params):
    response = client.get(API + path, params={"per_page": 100, **params})
    if response.status_code == 401 or "/login" in response.url.path:
        raise SessionExpired("canvas")
    response.raise_for_status()
    return response.json()


SEASON_ORDER = {"winter": 0, "spring": 1, "summer": 2, "fall": 3}
TERM_PATTERN = re.compile(r"(winter|spring|summer|fall)\s+(\d{4})", re.IGNORECASE)


def term_rank(course: dict) -> tuple[int, int] | None:
    """'Fall 2026' -> (2026, 3). UMD leaves term dates blank, so the name is what we have.
    Terms without a season and year (like 'Default Term' for advising groups) -> None."""
    match = TERM_PATTERN.search((course.get("term") or {}).get("name", ""))
    return (int(match.group(2)), SEASON_ORDER[match.group(1).lower()]) if match else None


def current_term_courses(courses: list[dict]) -> list[dict]:
    """Courses in the latest real term."""
    ranked = [(term_rank(c), c) for c in courses]
    ranked = [(rank, c) for rank, c in ranked if rank]
    if not ranked:
        return []
    latest = max(rank for rank, _ in ranked)
    return [c for rank, c in ranked if rank == latest]


def fetch() -> dict:
    now = datetime.now(timezone.utc)
    with session_client("canvas") as client:
        courses = current_term_courses(
            get_json(client, "/courses", enrollment_state="active", **{"include[]": ["term", "total_scores"]})
        )

        grades, scores = {}, []
        for course in courses:
            code = course.get("course_code") or course.get("name", "")
            enrollment = (course.get("enrollments") or [{}])[0]
            score = enrollment.get("computed_current_score")
            grades[code] = {
                "score": round(score, 1) if score is not None else None,
                "grade": enrollment.get("computed_current_grade"),  # letter, if the class shows one
            }

            submissions = get_json(client, f"/courses/{course['id']}/students/submissions",
                                   **{"student_ids[]": "self", "include[]": "assignment"})
            for sub in submissions:
                if sub.get("score") is None or not sub.get("graded_at") or sub.get("excused"):
                    continue
                assignment = sub.get("assignment") or {}
                graded_at = datetime.fromisoformat(sub["graded_at"].replace("Z", "+00:00"))
                scores.append({
                    "title": assignment.get("name", "Assignment"),
                    "course": code,
                    "earned": round(sub["score"], 2),
                    "total": assignment.get("points_possible"),
                    "graded_at": graded_at.isoformat(),
                    "due_at": assignment.get("due_at"),
                    "newly_graded": now - graded_at < FRESH_FOR,
                    "url": assignment.get("html_url"),
                })

    scores.sort(key=lambda s: s["graded_at"], reverse=True)
    term = (courses[0].get("term") or {}).get("name") if courses else None
    return {"term": term, "grades": grades, "scores": scores[:RECENT_SCORES]}


def main() -> None:
    data = fetch()
    print(f"{data['term']}: grades for {len(data['grades'])} classes, {len(data['scores'])} recent scores")
    for course, g in data["grades"].items():
        print(f"  {course:<10} {g['score']}%")


if __name__ == "__main__":
    main()
