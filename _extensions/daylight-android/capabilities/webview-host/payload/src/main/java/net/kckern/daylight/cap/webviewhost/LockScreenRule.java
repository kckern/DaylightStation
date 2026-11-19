package net.kckern.daylight.cap.webviewhost;

import net.kckern.daylight.api.KioskHost;

/**
 * Whether the window shows over the device's lock screen: the device file's decision
 * (webview.showWhenLocked), told to the shell's Activity, which does not show there
 * until it is told to. A kiosk with a swipe keyguard says yes. A personal device says
 * no: the household site must stay behind the lock.
 */
final class LockScreenRule {
    private LockScreenRule() { }

    /** True when the host was told. False for no host, or a shell installed before the host could be told. */
    static boolean apply(KioskHost host, boolean showWhenLocked) {
        if (host == null) return false;
        try {
            host.showWhenLocked(showWhenLocked);
            return true;
        } catch (LinkageError olderShell) {
            // That shell decided for itself; only a new install changes it.
            return false;
        }
    }
}
