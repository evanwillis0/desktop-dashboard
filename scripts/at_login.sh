#!/bin/bash
# Runs once each time you log in (started by launchd; see install_login.sh).
# Opens Übersicht so the dashboard is on the desktop, then hides the apps macOS reopened.

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"

echo "$(date '+%F %T') login: opening Übersicht"
open -b tracesOf.Uebersicht

echo "$(date '+%F %T') login: $(osascript "$SCRIPTS/hide_apps.applescript")"
