"""Read and write the dashboard's secrets in the macOS Keychain.

Every secret is stored under one Keychain "service" name, so they all show up
together in Keychain Access if you search for "desktop-dashboard".
"""

import keyring

SERVICE = "desktop-dashboard"


def get_secret(name: str) -> str | None:
    """Return the stored value for `name`, or None if it hasn't been set."""
    return keyring.get_password(SERVICE, name)


def set_secret(name: str, value: str) -> None:
    """Save `value` under `name`, replacing any existing value."""
    keyring.set_password(SERVICE, name, value)


def delete_secret(name: str) -> None:
    """Remove `name` from the Keychain if it exists."""
    try:
        keyring.delete_password(SERVICE, name)
    except keyring.errors.PasswordDeleteError:
        pass
