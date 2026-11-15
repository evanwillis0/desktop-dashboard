#!/bin/bash
# Keep the dashboard on the desktop. Run every 2 minutes by launchd (see install_login.sh).
#
# Übersicht draws widgets from a small built-in server on port 41416. If that server dies,
# the desktop goes blank while the Übersicht app keeps running. When the server doesn't
# answer, restart Übersicht. Does nothing (and logs nothing) while everything is healthy.

if curl -s -o /dev/null --max-time 5 http://127.0.0.1:41416/; then
  exit 0
fi

echo "$(date '+%F %T') watchdog: Übersicht's widget server isn't answering; restarting Übersicht"
pid=$(pgrep -f "MacOS/.*bersicht$")
if [ -n "$pid" ]; then
  kill -TERM "$pid"
  for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -f "MacOS/.*bersicht$" >/dev/null || break; sleep 1; done
fi
open -b tracesOf.Uebersicht
