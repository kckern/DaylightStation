package net.kckern.daylight.cap.lockdown;

/**
 * Observed HOME resolution. Pure Java (from portal-keys HomeWatchState).
 * A successful set-home command is never evidence; only what resolveActivity returns is.
 */
final class HomeState {
    boolean initialized;
    boolean homeIsKiosk;
    long incidents;
    String home;

    /** component is "package/activity", activity short (".X") or full. */
    static boolean isKioskHome(String component, String ownPackage, String... kioskClasses) {
        if (component == null) return false;
        String[] parts = component.split("/", -1);
        if (parts.length != 2 || !parts[0].equals(ownPackage)) return false;
        String activity = parts[1].startsWith(".") ? parts[0] + parts[1] : parts[1];
        for (String c : kioskClasses) if (activity.equals(c)) return true;
        return false;
    }

    /** "home-lost", "home-restored", or null when nothing changed. */
    String observe(String component, String ownPackage, String... kioskClasses) {
        boolean correct = isKioskHome(component, ownPackage, kioskClasses);
        String event = null;
        if ((!initialized && !correct) || (initialized && correct != homeIsKiosk)) {
            event = correct ? "home-restored" : "home-lost";
            if (!correct) incidents++;
        }
        initialized = true;
        homeIsKiosk = correct;
        home = component;
        return event;
    }
}
