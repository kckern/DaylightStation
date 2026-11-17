package net.kckern.daylight.cap.mediaservice.shell;

import net.kckern.daylight.shellkit.PackageFacts;
import net.kckern.daylight.shellkit.SignerPins;

import java.util.Map;

/**
 * Who may connect to the media session. Pure.
 *
 * The library service is exported, because a car, the system's media controls and a
 * headset reach it by binding it. That lets every app on the phone try. One that
 * connected could read the household's library and recent titles and start playback.
 *
 * A package name proves nothing: Media3 takes it from what the caller sends. The uid
 * is the caller's own, from Binder. So a connection is accepted from:
 *
 *  - this app (its uid and its name);
 *  - a system uid: an app id below 10000 (Process.FIRST_APPLICATION_UID), which covers
 *    the system server (1000), Bluetooth (1002), the media server (1013) and adb's
 *    shell (2000). No app a user installs runs there;
 *  - a package the caller's uid owns that is signed with the platform's certificate
 *    (the system UI, which runs under an app uid);
 *  - a package the caller's uid owns whose signing certificate is the one pinned for
 *    it in media.controllerPins.
 *
 * No package is trusted by name, and no certificate digest is compiled in. A package
 * with no pin is refused, and the refusal carries the digest Android reports for it,
 * so the owner can read it from the log and pin it.
 */
final class ControllerPolicy {
    /** What the platform reports for a legacy controller it cannot name (before Android 9). */
    static final String LEGACY_UNKNOWN = "android.media.session.MediaController";
    /** Process.FIRST_APPLICATION_UID: app ids below it are the system's own. */
    private static final int FIRST_APP_UID = 10_000;
    private static final int MAX_ID = 1000;

    /** Whether a controller may connect, and when not, why and what its certificate is. */
    static final class Decision {
        final boolean allowed;
        /** Fixed text. Empty when allowed. */
        final String reason;
        /** The package's certificate digest when it is the caller's own package and readable; else null. */
        final String observedDigest;

        private Decision(boolean allowed, String reason, String observedDigest) {
            this.allowed = allowed;
            this.reason = reason;
            this.observedDigest = observedDigest;
        }

        /**
         * The line for the log. The package name and a certificate digest are public
         * values, and say nothing about what is played.
         */
        String logLine(String packageName) {
            String line = "refused media controller " + packageName + ": " + reason;
            if (observedDigest != null) {
                line += ". To allow it, add " + packageName + "=" + observedDigest + " to media.controllerPins";
            }
            return line;
        }
    }

    private static Decision allow() { return new Decision(true, "", null); }

    private static Decision refuse(String reason, String digest) { return new Decision(false, reason, digest); }

    private ControllerPolicy() { }

    /**
     * @param uid  the caller's uid as Binder reports it; -1 when the platform cannot say
     * @param pins package to lower-case SHA-256 hex of its signing certificate
     */
    static Decision decide(String packageName, int uid, int myUid, String myPackage, int sdk,
                           PackageFacts facts, Map<String, String> pins) {
        if (packageName == null || packageName.isEmpty()) return refuse("the caller has no package name", null);
        if (uid == myUid && packageName.equals(myPackage)) return allow();
        // A uid is user * 100000 + app id; the app id is what says "system".
        if (uid >= 0 && uid % 100_000 < FIRST_APP_UID) return allow();
        // Before Android 9 a legacy controller arrives with no uid and no name of its own.
        if (uid < 0 || LEGACY_UNKNOWN.equals(packageName)) return refuse("the platform does not say who the caller is", null);
        // The system UI runs under an app uid; what makes it the system is the platform's signature.
        if (SignerPins.owns(facts, uid, packageName) && facts.platformSigned(packageName)) return allow();
        // Everything else: the caller's own package, signed with the certificate pinned for it.
        SignerPins.Result pinned = SignerPins.check(packageName, uid, facts, pins);
        if (!pinned.allowed) return refuse(pinned.reason, pinned.observedDigest);
        return allow();
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
