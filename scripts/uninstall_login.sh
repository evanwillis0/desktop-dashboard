#!/bin/bash
# Undo install_login.sh: stop the background server and remove its login agents.

DOMAIN="gui/$(id -u)"
for LABEL in local.desktop-dashboard.server local.desktop-dashboard.login local.desktop-dashboard.watchdog local.desktop-dashboard.unlock; do
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
done
echo "Removed. The dashboard will no longer start at login."
