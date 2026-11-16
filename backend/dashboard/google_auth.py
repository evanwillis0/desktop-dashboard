"""Google sign-in for the dashboard: one set of credentials per Google account.

Each account is connected once with setup_google.py. After that, the saved refresh
token (in the Keychain) lets the dashboard get fresh access without you signing in again.
Access is read-only: Gmail and Calendar can be read, never changed or sent from.
"""

import json
import threading

from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials

from dashboard.secrets import get_secret, set_secret

GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly"
SCOPES = [GMAIL_SCOPE, CALENDAR_SCOPE]

# Your Google accounts: dashboard label -> Chrome profile folder used to sign in and open links.
# The labels are only names for the setup command; the dashboard shows each account's real address.
# Both gmail.com accounts live in the "Default" profile; Google's account chooser picks between them.
ACCOUNTS = {
    "professional": "Default",  # gmail.com account used professionally
    "personal": "Default",  # gmail.com account used personally
    "umd": "Profile 1",  # terpmail.umd.edu
    "nova": "Profile 2",  # email.vccs.edu
}

SETUP_HINT = "../.venv/bin/python -m dashboard.setup_google"


def client_config() -> dict:
    """The OAuth client (your Google Cloud project's 'Desktop app' credentials)."""
    raw = get_secret("google_client")
    if not raw:
        raise RuntimeError(f"Google client isn't set up. Run: {SETUP_HINT} client <downloaded-file.json>")
    return json.loads(raw)


def token_key(label: str) -> str:
    return f"google_token_{label}"


def save_credentials(label: str, creds: Credentials, granted: list[str] | None = None) -> None:
    """Save credentials. `granted` records which permissions you actually allowed
    (Google lets you untick some), so we only ever ask for those."""
    info = json.loads(creds.to_json())
    if granted is not None:
        info["scopes"] = sorted(granted)
    set_secret(token_key(label), json.dumps(info))


def granted_scopes(label: str) -> set[str]:
    raw = get_secret(token_key(label))
    return set(json.loads(raw).get("scopes", [])) if raw else set()


def has_scope(label: str, scope: str) -> bool:
    return scope in granted_scopes(label)


def save_email(label: str, email: str) -> None:
    set_secret(f"google_email_{label}", email)


def account_email(label: str) -> str | None:
    """The address this account was connected as (used for tab names and Gmail links)."""
    return get_secret(f"google_email_{label}")


# One lock per account. Gmail and Calendar both use the UMD account and can run at the same
# time (the widget's Refresh button refreshes everything at once); without this, both would
# renew an expired token and save it simultaneously. With it, the second waits and then
# finds the token the first one just saved.
_account_locks = {label: threading.Lock() for label in ACCOUNTS}


def load_credentials(label: str) -> Credentials:
    """Credentials for one account, refreshed if the short-lived access token expired."""
    with _account_locks.get(label) or threading.Lock():
        raw = get_secret(token_key(label))
        if not raw:
            raise RuntimeError(f"Google account '{label}' isn't connected. Run: {SETUP_HINT} {label}")

        # Use the saved (granted) permissions, not SCOPES: asking to refresh a permission
        # you never allowed would make Google reject the refresh.
        creds = Credentials.from_authorized_user_info(json.loads(raw))
        if not creds.valid:
            try:
                creds.refresh(Request())
            except RefreshError:
                raise RuntimeError(f"Google sign-in for '{label}' expired or was revoked. Run: {SETUP_HINT} {label}")
            save_credentials(label, creds)
        return creds
