"""Piazza: the newest posts in your active classes, with unread, instructor and unanswered flags.

Piazza has no public API, but its website loads everything from an internal one
(piazza.com/logic/api). This asks it the same questions, using the login saved by
`setup_login piazza`. Read-only: nothing is posted or marked as read.

Try it from the backend/ folder:
    ../.venv/bin/python -m dashboard.sources.piazza
"""

import html
import re
from datetime import datetime, timedelta, timezone

from dashboard.sessions import SessionExpired, session_client

API = "https://piazza.com/logic/api"
FEED_SIZE = 50  # newest posts read per class (unread is counted within these)
KEEP = 12  # posts per class sent to the widget (it shows fewer)

SEASON_ORDER = {"winter": 0, "spring": 1, "summer": 2, "fall": 3}


def call(client, method: str, params: dict) -> dict:
    response = client.post(
        f"{API}?method={method}",
        json={"method": method, "params": params},
        # Piazza's website sends its session id back as a CSRF token; it rejects requests without it.
        headers={"CSRF-Token": client.cookies.get("session_id") or ""},
    )
    if response.status_code in (401, 403):
        raise SessionExpired("piazza")
    response.raise_for_status()
    body = response.json()
    error = body.get("error")
    if error:
        if "log" in str(error).lower():  # "Not logged in", "Please log in"
            raise SessionExpired("piazza")
        raise RuntimeError(f"Piazza error: {error}")
    return body.get("result") or {}


def term_rank(term: str) -> tuple[int, int]:
    match = re.search(r"(winter|spring|summer|fall)\s+(\d{4})", term or "", re.IGNORECASE)
    return (int(match.group(2)), SEASON_ORDER[match.group(1).lower()]) if match else (0, 0)


def clean(text: str) -> str:
    """Piazza sends HTML-escaped text ('Q&amp;A'); turn it back into plain text."""
    return html.unescape(re.sub(r"<[^>]+>", " ", text or "")).strip()


def parse_post(post: dict, class_id: str) -> dict:
    tags = post.get("tags") or []
    return {
        "id": post["id"],
        "number": post.get("nr"),
        "subject": clean(post.get("subject")) or "(no subject)",
        "snippet": clean(post.get("content_snipet"))[:160],
        "type": post.get("type"),  # question, note, poll
        "unread": bool(post.get("is_new")),
        "instructor": "instructor-note" in tags,
        "pinned": bool(post.get("pin")),
        "unanswered": post.get("type") == "question" and post.get("no_answer") == 1,
        "updated": post.get("updated") or post.get("modified"),
        "url": f"https://piazza.com/class/{class_id}/post/{post.get('nr')}",
    }


def fetch() -> dict:
    with session_client("piazza") as client:
        networks = [n for n in call(client, "user.status", {}).get("networks", []) if n.get("status") == "active"]
        # Only the latest term (an old class can stay "active" if the instructor never closes it).
        if networks:
            latest = max(term_rank(n.get("term")) for n in networks)
            networks = [n for n in networks if term_rank(n.get("term")) == latest]

        classes = []
        for network in networks:
            feed = call(client, "network.get_my_feed",
                        {"nid": network["id"], "limit": FEED_SIZE, "offset": 0, "sort": "updated"})
            posts = [parse_post(p, network["id"]) for p in feed.get("feed", [])]
            # Piazza lists pinned posts first even when they're months old. Keep a pinned post
            # only if it's unread or changed in the last week; then order everything newest first.
            week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
            posts = [p for p in posts if not p["pinned"] or p["unread"] or (p["updated"] or "") >= week_ago]
            posts.sort(key=lambda p: p["updated"] or "", reverse=True)
            classes.append({
                "id": network["id"],
                "name": network.get("course_number") or network.get("name", ""),
                "term": network.get("term"),
                "unread": sum(p["unread"] for p in posts),
                "unread_capped": len(posts) == FEED_SIZE and all(p["unread"] for p in posts),
                "url": f"https://piazza.com/class/{network['id']}",
                "posts": posts[:KEEP],
            })
    return {"classes": classes}


def main() -> None:
    for c in fetch()["classes"]:
        print(f"{c['name']} ({c['term']}): {c['unread']} unread of the newest {FEED_SIZE}")
        for p in c["posts"][:5]:
            flags = "".join(f for f, on in (("•", p["unread"]), ("I", p["instructor"]), ("?", p["unanswered"])) if on)
            print(f"  {flags:<3} {p['subject'][:60]}")


if __name__ == "__main__":
    main()
