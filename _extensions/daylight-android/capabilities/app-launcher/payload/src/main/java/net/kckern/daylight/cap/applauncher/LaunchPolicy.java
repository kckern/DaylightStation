package net.kckern.daylight.cap.applauncher;

import net.kckern.daylight.core.kiosk.AllowRules;

/** May this resolved activity be started? Pure Java. */
final class LaunchPolicy {
    private LaunchPolicy() { }

    /**
     * Null when the launch may go ahead, else "not_installed" or "not_allowed".
     * What is checked is the activity the request RESOLVED to, so an action-only intent
     * or an intent: URI cannot reach an app that is not on the list, and the system's
     * chooser (which stands in when several apps could take an intent) is never allowed.
     *
     * @param gateClosed a package gate (a lease) has closed this package
     */
    static String refusal(String resolvedPackage, String resolvedClass, AllowRules allowed, boolean gateClosed) {
        if (resolvedPackage == null || resolvedClass == null) return "not_installed";
        if ("android".equals(resolvedPackage)) return "not_allowed";
        if (gateClosed) return "not_allowed";
        return allowed.matches(resolvedPackage, resolvedClass) ? null : "not_allowed";
    }
}
