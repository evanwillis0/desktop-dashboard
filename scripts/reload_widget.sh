#!/bin/bash
# Make Übersicht's desktop window load the latest widget code.
# Übersicht recompiles widgets when files change, but the desktop window doesn't always
# pick up the new version on its own; this is the same as its menu's "Refresh All Widgets".
osascript -e 'tell application id "tracesOf.Uebersicht" to refresh' && echo "Übersicht widgets reloaded."
