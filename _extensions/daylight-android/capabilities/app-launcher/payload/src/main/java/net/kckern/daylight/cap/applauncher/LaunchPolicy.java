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

    /**
     * What the watcher is told to let stay in front after an allowed launch: null (the
     * whole package) when a package or wildcard rule allows it, and the resolved
     * activity when only a rule naming that activity does. A rule matches a package
     * with an unknown activity (null) exactly when it is not an activity-level rule.
     */
    static String exemptActivity(String resolvedPackage, String resolvedClass, AllowRules allowed) {
        return allowed.matches(resolvedPackage, null) ? null : resolvedClass;
    }
}
