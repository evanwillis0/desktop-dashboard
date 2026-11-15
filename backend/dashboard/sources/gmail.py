"""Gmail: the last week of inbox mail for each connected account, with unread highlighted.

Why "recent" instead of "all unread": old unread mail piles up into the thousands, and
school accounts don't use Gmail's Primary tab, so a recent window is the useful snapshot.

Read-only. Each account is fetched separately, so one broken account (say, a revoked
sign-in) shows an error on its own tab while the others keep working.

Try it from the backend/ folder:
    ../.venv/bin/python -m dashboard.sources.gmail
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from email.utils import parseaddr
from urllib.parse import quote

import httpx

from dashboard.google_auth import ACCOUNTS, account_email, load_credentials

API = "https://gmail.googleapis.com/gmail/v1/users/me"
# Last 7 days of inbox mail, minus Promotions and Social (on accounts without inbox
# tabs those categories are empty, so nothing is filtered out there).
RECENT_QUERY = "in:inbox newer_than:7d -category:promotions -category:social"
UNREAD_QUERY = RECENT_QUERY + " is:unread"
# Same filters, last 24 hours only (for the "new emails" count in the center circle).
UNREAD_TODAY_QUERY = "in:inbox newer_than:1d is:unread -category:promotions -category:social"
MAX_MESSAGES = 6  # shown on the card
MAX_COUNTED = 100  # unread counts above this show as "99+"

# Tab names shown on the card.
DISPLAY_NAMES = {"professional": "Professional", "personal": "Personal", "umd": "UMD", "nova": "NOVA"}


def sender_name(from_header: str) -> str:
    """'Jane Doe <jane@x.com>' -> 'Jane Doe'; '<jane@x.com>' -> 'jane@x.com'."""
    name, address = parseaddr(from_header)
    return name or address or from_header


def inbox_link(email: str, thread_id: str | None = None) -> str:
    """Open Gmail as this exact account (matters when two accounts share a Chrome profile).

    `authuser=` is Gmail's supported way to pick the account; `#all/<thread>` finds the
    conversation wherever it is (inbox, archived, or labeled).
    """
    base = f"https://mail.google.com/mail/?authuser={quote(email)}"
    return f"{base}#all/{thread_id}" if thread_id else f"{base}#inbox"


def fetch_account(label: str) -> dict:
    email = account_email(label)
    result = {
        "label": label,
        "name": DISPLAY_NAMES.get(label, label),
        "email": email,
        "chrome_profile": ACCOUNTS[label],
        "inbox_url": inbox_link(email) if email else None,
        "unread_recent": 0,  # unread in the last 7 days (capped at MAX_COUNTED)
        "unread_today": 0,  # unread in the last 24 hours (capped at MAX_COUNTED)
        "messages": [],
        "error": None,
    }
    try:
        creds = load_credentials(label)
        headers = {"Authorization": f"Bearer {creds.token}"}
        with httpx.Client(base_url=API, headers=headers, timeout=20) as client:
            # Count unread by listing their IDs (exact, unlike Gmail's size estimate).
            unread = client.get("/messages", params={"q": UNREAD_QUERY, "maxResults": MAX_COUNTED})
            unread.raise_for_status()
            result["unread_recent"] = len(unread.json().get("messages", []))

            today = client.get("/messages", params={"q": UNREAD_TODAY_QUERY, "maxResults": MAX_COUNTED})
            today.raise_for_status()
            result["unread_today"] = len(today.json().get("messages", []))

            recent = client.get("/messages", params={"q": RECENT_QUERY, "maxResults": MAX_MESSAGES})
            recent.raise_for_status()
            ids = [m["id"] for m in recent.json().get("messages", [])]

            for message_id in ids:
                message = client.get(
                    f"/messages/{message_id}",
                    params={"format": "metadata", "metadataHeaders": ["From", "Subject"]},
                )
                message.raise_for_status()
                result["messages"].append(parse_message(message.json(), email))
    except httpx.HTTPStatusError as error:
        result["error"] = f"Gmail error {error.response.status_code}"
    except httpx.HTTPError as error:
        result["error"] = f"Network problem ({type(error).__name__})"
    except RuntimeError as error:  # not connected / sign-in expired (message says how to fix)
        result["error"] = str(error)
    return result


def parse_message(message: dict, email: str) -> dict:
    headers = {h["name"].lower(): h["value"] for h in message.get("payload", {}).get("headers", [])}
    received = datetime.fromtimestamp(int(message["internalDate"]) / 1000, tz=timezone.utc)
    return {
        "from": sender_name(headers.get("from", "")),
        "subject": headers.get("subject") or "(no subject)",
        "snippet": message.get("snippet", ""),
        "unread": "UNREAD" in message.get("labelIds", []),
        "received_at": received.isoformat(),
        "url": inbox_link(email, message.get("threadId")),
    }


def fetch() -> dict:
    """All accounts, fetched in parallel, in the order listed in ACCOUNTS."""
    with ThreadPoolExecutor(max_workers=len(ACCOUNTS)) as pool:
        accounts = list(pool.map(fetch_account, ACCOUNTS))
    return {"accounts": accounts}


def main() -> None:
    for account in fetch()["accounts"]:
        print(f"{account['name']} ({account['email']}): {account['unread_recent']} unread in the last 7 days")
        if account["error"]:
            print(f"  error: {account['error']}")
        for m in account["messages"]:
            print(f"  {'•' if m['unread'] else ' '} {m['from'][:24]:<24} {m['subject'][:50]}")
        print()


if __name__ == "__main__":
    main()
