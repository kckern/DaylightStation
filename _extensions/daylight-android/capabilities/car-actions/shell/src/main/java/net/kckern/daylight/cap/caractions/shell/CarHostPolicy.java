package net.kckern.daylight.cap.caractions.shell;

import net.kckern.daylight.shellkit.PackageFacts;
import net.kckern.daylight.shellkit.SignerPins;

import java.util.Map;

/**
 * Which car host may bind the car screen. Pure.
 *
 * The car app service is exported: Android Auto binds it, and no permission exists that
 * only Android Auto holds. So every app on the phone can try. The Car App Library's own
 * host check also accepts any package that holds the TEMPLATE_RENDERER permission, a
 * permission no phone defines, so an app could define and hold it itself. This check
 * is stricter, and is the one the screen obeys:
 *
 *  - the binding uid must own Android Auto's package;
 *  - that package's one signing certificate must be the one pinned for it in
 *    car.hostPins (SignerPins, as the media service holds controllers to
 *    media.controllerPins).
 *
 * Nothing else is a car host: not another pinned app, not a platform-signed app, not a
 * system uid. With no pin Android Auto is refused too, and the refusal carries the
 * digest Android reports for it, so the owner can pin it on the first connection.
 */
final class CarHostPolicy {
    /** Android Auto's package (named in the Car App Library's own sample host list). */
    static final String ANDROID_AUTO = "com.google.android.projection.gearhead";

    static final class Decision {
        final boolean allowed;
        /** The binding uid the decision was made for. */
        final int uid;
        /** Fixed text. Empty when allowed. */
        final String reason;
        /** What the uid runs, for the log line: Android Auto's package, or the first it owns. */
        final String packageName;
        /** Android Auto's certificate digest when it is the caller's and readable; else null. */
        final String observedDigest;
        /** The pin that matched, when allowed; the library's own check is handed this one host. */
        final String pinnedDigest;

        Decision(boolean allowed, int uid, String reason, String packageName, String observedDigest, String pinnedDigest) {
            this.allowed = allowed;
            this.uid = uid;
            this.reason = reason;
            this.packageName = packageName;
            this.observedDigest = observedDigest;
            this.pinnedDigest = pinnedDigest;
        }

        /** The line for the log: a package name and a certificate digest, both public values. */
        String logLine() {
            String line = "refused car host " + packageName + ": " + reason;
            if (observedDigest != null) line += ". To allow it, add " + packageName + "=" + observedDigest + " to car.hostPins";
            return line;
        }
    }

    private CarHostPolicy() { }

    /**
     * @param uid  the binding uid as Binder reports it; -1 when it is not known
     * @param pins package to lower-case SHA-256 hex of its signing certificate
     */
    static Decision decide(int uid, PackageFacts facts, Map<String, String> pins) {
        if (uid < 0) return new Decision(false, uid, "the binding app is not known", "(unknown)", null, null);
        if (!SignerPins.owns(facts, uid, ANDROID_AUTO)) {
            String[] owned = facts.packagesForUid(uid);
            String name = owned != null && owned.length > 0 ? owned[0] : "uid " + uid;
            return new Decision(false, uid, "the binding app is not Android Auto", name, null, null);
        }
        SignerPins.Result r = SignerPins.check(ANDROID_AUTO, uid, facts, pins);
        if (!r.allowed) return new Decision(false, uid, r.reason, ANDROID_AUTO, r.observedDigest, null);
        return new Decision(true, uid, "", ANDROID_AUTO, null, pins.get(ANDROID_AUTO));
    }

    /** Whether the screen may serve the host the library settled on: the one that passed, at its uid. */
    static boolean serves(Decision d, String hostPackage, int hostUid) {
        return d != null && d.allowed && d.uid == hostUid && ANDROID_AUTO.equals(hostPackage);
    }
}
