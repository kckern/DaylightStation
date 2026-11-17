package net.kckern.daylight.cap.mediaservice.shell;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * Who may connect to the media session. Pure.
 *
 * The library service is exported, because a car, the system's media controls and a
 * headset reach it by binding it. That lets every app on the phone try. One that
 * connected could read the household's library and start playback, so a connection is
 * accepted only from this app, from the system, and from the few apps named here.
 */
final class ControllerPolicy {
    /** What the platform reports for a legacy controller it cannot name (before Android 9). */
    static final String LEGACY_UNKNOWN = "android.media.session.MediaController";
    /** Uids below this are the system's own (system 1000, Bluetooth 1002, media 1013). */
    private static final int FIRST_APP_UID = 10_000;
    private static final int MAX_ID = 1000;

    private static final Set<String> ALLOWED = new HashSet<>(Arrays.asList(
            "com.android.systemui",                       // lock screen, notification shade
            "com.google.android.projection.gearhead",     // Android Auto
            "com.google.android.googlequicksearchbox",    // Assistant: "play", "pause", "next"
            "com.google.android.carassistant",            // Assistant driving mode
            "com.google.android.wearable.app",            // a paired watch's media controls
            "com.android.bluetooth"));

    private ControllerPolicy() { }

    static boolean allows(String packageName, int uid, int myUid, String myPackage, int sdk) {
        if (packageName == null || packageName.isEmpty()) return false;
        if (uid == myUid && packageName.equals(myPackage)) return true;
        // A uid is user * 100000 + app id; the app id is what says "system".
        if (uid >= 0 && uid % 100_000 < FIRST_APP_UID) return true;
        if (LEGACY_UNKNOWN.equals(packageName)) return sdk < 28;
        return ALLOWED.contains(packageName);
    }

    /**
     * The id the play screen was started with, or null. The screen is not exported, so
     * the extra comes from this app; it is still only passed on when it has the shape of
     * a playable or a container id. The payload checks the id itself and asks the backend.
     */
    static String playRequest(String id) {
        if (id == null || id.length() < 3 || id.length() > MAX_ID) return null;
        if (!(id.startsWith("p:") || id.startsWith("c:"))) return null;
        for (int i = 0; i < id.length(); i++) if (id.charAt(i) < 0x20 || id.charAt(i) == 0x7f) return null;
        return id;
    }
}
