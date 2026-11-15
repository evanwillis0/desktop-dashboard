"""One-time Google setup. Run from the backend/ folder.

Step 1, once: store the OAuth client file you downloaded from Google Cloud.
    ../.venv/bin/python -m dashboard.setup_google client ~/Downloads/client_secret_XXXX.json

Step 2, once per account: sign in (opens Chrome in that account's profile).
    ../.venv/bin/python -m dashboard.setup_google professional
    ../.venv/bin/python -m dashboard.setup_google personal
    ../.venv/bin/python -m dashboard.setup_google umd
    ../.venv/bin/python -m dashboard.setup_google nova
"""

import json
import os
import subprocess
import sys
import webbrowser
from pathlib import Path

import httpx
from google_auth_oauthlib.flow import InstalledAppFlow

from dashboard.google_auth import (
    ACCOUNTS,
    CALENDAR_SCOPE,
    GMAIL_SCOPE,
    SCOPES,
    client_config,
    save_credentials,
    save_email,
)

# Google lets you untick permissions on the consent screen. By default the sign-in
# library then crashes; this makes it accept the partial grant so we can check it ourselves.
os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"] = "1"
from dashboard.secrets import set_secret


class ChromeProfile(webbrowser.BaseBrowser):
    """Opens the Google sign-in page in a specific Chrome profile, so you sign in to the right account."""

    def __init__(self, profile: str):
        super().__init__("chrome-profile")
        self.profile = profile

    def open(self, url, new=0, autoraise=True):
        subprocess.run(["open", "-na", "Google Chrome", "--args", f"--profile-directory={self.profile}", url])
        return True


def store_client(path_text: str) -> None:
    path = Path(path_text).expanduser()
    try:
        config = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        print(f"Couldn't read that file: {error}")
        return
    if "installed" not in config or "client_id" not in config["installed"]:
        print("That isn't a 'Desktop app' OAuth client file. In Google Cloud, create credentials of type "
              "OAuth client ID -> Desktop app, then download it.")
        return
    set_secret("google_client", json.dumps(config))
    print("Saved the Google client to the Keychain.")
    print(f"You can now delete the downloaded file: {path}")


def connect_account(label: str) -> None:
    profile = ACCOUNTS[label]
    webbrowser.register("chrome-profile", None, ChromeProfile(profile))

    flow = InstalledAppFlow.from_client_config(client_config(), SCOPES)
    print(f"Opening Google sign-in in Chrome ({profile}). Sign in with your {label} account...")
    creds = flow.run_local_server(
        port=0,
        browser="chrome-profile",
        prompt="consent",  # always return a refresh token, even if you approved before
        success_message="Connected to desktop-dashboard. You can close this tab.",
    )

    # Google returns the permissions you actually allowed (as a list or a space-separated string).
    scope = flow.oauth2session.token.get("scope", SCOPES)
    granted = set(scope.split() if isinstance(scope, str) else scope)
    if GMAIL_SCOPE not in granted:
        print("Gmail permission wasn't allowed, so this account can't be used. Nothing was saved.\n"
              "Run this again and tick the Gmail box on Google's permission screen.")
        return

    # Ask Gmail which address we got, so a sign-in to the wrong account is caught.
    profile_info = httpx.get(
        "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        headers={"Authorization": f"Bearer {creds.token}"},
        timeout=15,
    )
    profile_info.raise_for_status()
    email = profile_info.json()["emailAddress"]

    save_credentials(label, creds, granted=list(granted))
    save_email(label, email)
    print(f"Connected '{label}' as {email}. Saved to the Keychain.")
    if CALENDAR_SCOPE not in granted:
        print("Note: Calendar wasn't allowed, so this account won't appear on the Calendar card.\n"
              "To add it later, run this again and tick the Calendar box.")


def main() -> None:
    args = sys.argv[1:]
    if len(args) == 2 and args[0] == "client":
        store_client(args[1])
    elif len(args) == 1 and args[0] in ACCOUNTS:
        connect_account(args[0])
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
