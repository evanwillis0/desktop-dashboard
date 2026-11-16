// Shows the desktop when you come back to the Mac after a break, so the dashboard is the
// first thing you see (the same as Mission Control's "Show Desktop" gesture: your windows
// slide off the edges, and doing the gesture again brings them back where they were).
//
// "A break" = the screen was locked or the display was asleep (closing the lid does both)
// for at least N minutes. Shorter breaks leave your windows alone.
//
// install_login.sh compiles this to build/unlock-watcher and runs it in the background at
// every login. Usage: unlock-watcher [minutes]   (default 5)

import AppKit
import CoreGraphics

let minutes = CommandLine.arguments.count > 1 ? Double(CommandLine.arguments[1]) ?? 5 : 5

// Show Desktop is triggered by sending the Dock the same message the gesture/F11 sends.
// (The function isn't in Apple's public headers, so look it up at runtime; it needs no
// extra permissions. The older `Mission Control 1` trick no longer works on macOS 15.)
typealias DockNotify = @convention(c) (CFString, Int32) -> Void
let dockNotify: DockNotify? = {
    let lib = dlopen("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices", RTLD_LAZY)
    guard let symbol = dlsym(lib, "CoreDockSendNotification") else { return nil }
    return unsafeBitCast(symbol, to: DockNotify.self)
}()

var awaySince: Date? = nil

func log(_ message: String) {
    let stamp = DateFormatter.localizedString(from: Date(), dateStyle: .short, timeStyle: .medium)
    print("\(stamp) \(message)")
    fflush(stdout)
}

func screenIsLocked() -> Bool {
    guard let session = CGSessionCopyCurrentDictionary() as? [String: Any] else { return false }
    return session["CGSSessionScreenIsLocked"] as? Bool ?? false
}

func wentAway(_ why: String) {
    if awaySince == nil {
        awaySince = Date()
        log("away (\(why))")
    }
}

func cameBack(_ why: String) {
    guard let since = awaySince else { return }  // already handled this break
    awaySince = nil
    let seconds = Date().timeIntervalSince(since)
    if seconds < minutes * 60 {
        log("back after \(Int(seconds))s (\(why)): short break, leaving windows")
        return
    }
    guard let notify = dockNotify else {
        log("back after \(Int(seconds / 60)) min (\(why)): can't show the desktop (Dock function missing)")
        return
    }
    log("back after \(Int(seconds / 60)) min (\(why)): showing the desktop")
    notify("com.apple.showdesktop.awake" as CFString, 0)
}

// The screen locked/unlocked (closing the lid locks it if a password is required after sleep).
let distributed = DistributedNotificationCenter.default()
distributed.addObserver(forName: .init("com.apple.screenIsLocked"), object: nil, queue: .main) { _ in
    wentAway("locked")
}
distributed.addObserver(forName: .init("com.apple.screenIsUnlocked"), object: nil, queue: .main) { _ in
    // Give the desktop a moment to appear before moving windows.
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { cameBack("unlocked") }
}

// The display slept/woke (covers Macs that don't ask for a password after sleep).
let workspace = NSWorkspace.shared.notificationCenter
workspace.addObserver(forName: NSWorkspace.screensDidSleepNotification, object: nil, queue: .main) { _ in
    wentAway("display slept")
}
workspace.addObserver(forName: NSWorkspace.screensDidWakeNotification, object: nil, queue: .main) { _ in
    // If the lock screen is up, wait for the unlock instead.
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
        if !screenIsLocked() { cameBack("display woke") }
    }
}

log("watching: shows the desktop after breaks of \(Int(minutes))+ min" + (dockNotify == nil ? " (WARNING: Dock function missing)" : ""))
RunLoop.main.run()
