-- Hide (not quit) the apps macOS reopens at login, so the desktop dashboard is the first thing you see.
-- Hidden apps keep all their windows and tabs; click one in the Dock (or Cmd-Tab) to bring it back.
--
-- Apps reopen over several seconds, so this checks three times (about 5, 15 and 30 seconds after login).
-- Each app is hidden at most once, so anything you open yourself after it was first hidden stays visible.
--
-- Pass "dry-run" to only list what would be hidden:
--   osascript scripts/hide_apps.applescript dry-run

on run argv
	set dryRun to (count of argv) > 0 and item 1 of argv is "dry-run"
	set keepVisible to {"tracesOf.Uebersicht"} -- never hide Übersicht: the dashboard lives in it
	set waits to {5, 10, 15}
	if dryRun then set waits to {0}

	set alreadyHidden to {}
	repeat with waitSeconds in waits
		delay waitSeconds
		tell application "System Events"
			set visibleApps to every application process whose visible is true and background only is false
			repeat with appProcess in visibleApps
				set appId to bundle identifier of appProcess
				if keepVisible does not contain appId and alreadyHidden does not contain appId then
					if not dryRun then set visible of appProcess to false
					set end of alreadyHidden to appId
				end if
			end repeat
		end tell
	end repeat

	set AppleScript's text item delimiters to ", "
	return "Hid: " & (alreadyHidden as text)
end run
