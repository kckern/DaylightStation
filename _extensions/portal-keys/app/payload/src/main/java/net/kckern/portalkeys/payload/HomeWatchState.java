package net.kckern.portalkeys.payload;

/** Observed Android HOME state. A successful repair command is never health evidence. */
final class HomeWatchState {
    boolean initialized, homeCorrect;
    long incidents, checkedAt;
    String home;

    static boolean isFullyHome(String component) {
        if (component == null) return false;
        String[] parts = component.split("/", -1);
        if (parts.length != 2 || !parts[0].equals("de.ozerov.fully")) return false;
        String activity = parts[1].startsWith(".") ? parts[0] + parts[1] : parts[1];
        return activity.equals("de.ozerov.fully.LauncherReplacement")
                || activity.equals("de.ozerov.fully.FakeLauncher");
    }

    String observe(String component, long now) {
        boolean correct = isFullyHome(component);
        String event = null;
        if ((!initialized && !correct) || (initialized && correct != homeCorrect)) {
            event = correct ? "home-restored" : "home-lost";
            if (!correct) incidents++;
        }
        initialized = true;
        homeCorrect = correct;
        home = component;
        checkedAt = now;
        return event;
    }
}
