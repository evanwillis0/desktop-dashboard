"""Read and write the dashboard's secrets in the macOS Keychain.

Every secret is stored under one Keychain "service" name, so they all show up
together in Keychain Access if you search for "desktop-dashboard".
"""

import threading
import time

import keyring

SERVICE = "desktop-dashboard"

# Saving to the Keychain isn't safe to do twice at once: replacing an entry is "remove,
# then add", so two saves of the same entry can both try to add it and the second fails
# with error -25299 ("already exists"). Saves inside this program take turns.
_write_lock = threading.Lock()


def get_secret(name: str) -> str | None:
    """Return the stored value for `name`, or None if it hasn't been set."""
    return keyring.get_password(SERVICE, name)


def set_secret(name: str, value: str) -> None:
    """Save `value` under `name`, replacing any existing value."""
    with _write_lock:
        try:
            keyring.set_password(SERVICE, name, value)
        except keyring.errors.PasswordSetError:
            # Another program (say, a setup script) saved the same entry at that moment. Retry once.
            time.sleep(0.2)
            keyring.set_password(SERVICE, name, value)


def delete_secret(name: str) -> None:
    """Remove `name` from the Keychain if it exists."""
    try:
        keyring.delete_password(SERVICE, name)
    except keyring.errors.PasswordDeleteError:
        pass
