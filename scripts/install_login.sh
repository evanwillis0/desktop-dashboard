#!/bin/bash
# Set up the dashboard to start automatically when you log in.
#
# Installs two launchd agents (macOS's built-in way to run things at login) into ~/Library/LaunchAgents:
#   local.desktop-dashboard.server  runs the Python server in the background; restarts it if it crashes
#   local.desktop-dashboard.login   runs scripts/at_login.sh once per login (open Übersicht, hide apps)
#   local.desktop-dashboard.watchdog runs scripts/watchdog.sh every 2 minutes (restarts Übersicht if its
#                                    widget server stops, so the desktop never stays blank)
#
# Safe to run again (it replaces the old agents). Undo with scripts/uninstall_login.sh.
# Logs go to ~/Library/Logs/desktop-dashboard/.

set -euo pipefail

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs/desktop-dashboard"
SERVER_LABEL="local.desktop-dashboard.server"
LOGIN_LABEL="local.desktop-dashboard.login"
WATCHDOG_LABEL="local.desktop-dashboard.watchdog"
DOMAIN="gui/$(id -u)"

mkdir -p "$AGENTS" "$LOGS"
chmod +x "$PROJECT/scripts/at_login.sh" "$PROJECT/scripts/watchdog.sh"

cat > "$AGENTS/$WATCHDOG_LABEL.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$WATCHDOG_LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$PROJECT/scripts/watchdog.sh</string></array>
  <key>StartInterval</key><integer>120</integer>
  <key>StandardOutPath</key><string>$LOGS/watchdog.log</string>
  <key>StandardErrorPath</key><string>$LOGS/watchdog.log</string>
</dict>
</plist>
EOF

cat > "$AGENTS/$SERVER_LABEL.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$SERVER_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PROJECT/.venv/bin/python</string>
    <string>-m</string>
    <string>dashboard.server</string>
  </array>
  <key>WorkingDirectory</key><string>$PROJECT/backend</string>
  <key>EnvironmentVariables</key>
  <dict><key>PYTHONUNBUFFERED</key><string>1</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOGS/server.log</string>
  <key>StandardErrorPath</key><string>$LOGS/server.log</string>
</dict>
</plist>
EOF

cat > "$AGENTS/$LOGIN_LABEL.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LOGIN_LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$PROJECT/scripts/at_login.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOGS/login.log</string>
  <key>StandardErrorPath</key><string>$LOGS/login.log</string>
</dict>
</plist>
EOF

plutil -lint "$AGENTS/$SERVER_LABEL.plist" "$AGENTS/$LOGIN_LABEL.plist" "$AGENTS/$WATCHDOG_LABEL.plist"

# Unload an agent (if loaded), wait until launchd has really let go of it, then load the
# new version. Loading too soon fails with "Bootstrap failed: 5".
reload_agent() {
  local label="$1"
  launchctl bootout "$DOMAIN/$label" 2>/dev/null || true
  for _ in $(seq 1 20); do
    launchctl print "$DOMAIN/$label" >/dev/null 2>&1 || break
    sleep 0.5
  done
  launchctl bootstrap "$DOMAIN" "$AGENTS/$label.plist"
}

# Start the watchdog now (it only acts if Übersicht's widget server is down).
reload_agent "$WATCHDOG_LABEL"

# Start the server now. (The login agent is NOT started now, since it would hide your
# apps right away; launchd runs it automatically the next time you log in.)
reload_agent "$SERVER_LABEL"

echo "Installed. Server is running in the background; Übersicht + hide-apps will run at your next login."
