"""Google sign-in for the dashboard: one set of credentials per Google account.

Each account is connected once with setup_google.py. After that, the saved refresh
token (in the Keychain) lets the dashboard get fresh access without you signing in again.
Access is read-only: Gmail and Calendar can be read, never changed or sent from.
"""

import json

from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials

from dashboard.secrets import get_secret, set_secret

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.readonly",
]

# Your Google accounts: dashboard label -> Chrome profile folder that's signed in to it.
ACCOUNTS = {
    "personal": "Default",  # gmail.com
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


def save_credentials(label: str, creds: Credentials) -> None:
    set_secret(token_key(label), creds.to_json())


def load_credentials(label: str) -> Credentials:
    """Credentials for one account, refreshed if the short-lived access token expired."""
    raw = get_secret(token_key(label))
    if not raw:
        raise RuntimeError(f"Google account '{label}' isn't connected. Run: {SETUP_HINT} {label}")

    creds = Credentials.from_authorized_user_info(json.loads(raw), SCOPES)
    if not creds.valid:
        try:
            creds.refresh(Request())
        except RefreshError:
            raise RuntimeError(f"Google sign-in for '{label}' expired or was revoked. Run: {SETUP_HINT} {label}")
        save_credentials(label, creds)
    return creds
