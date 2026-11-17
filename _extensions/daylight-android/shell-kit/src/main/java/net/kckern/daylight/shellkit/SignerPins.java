package net.kckern.daylight.shellkit;

import org.json.JSONObject;

import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;

/**
 * Holds a caller to a pinned signing certificate. Pure.
 *
 * A package name proves nothing: a binding app says what it is called. The uid is the
 * caller's own, from Binder. So a caller is allowed here only when the package is one
 * its uid owns, and that package's one signing certificate is the one pinned for it.
 * No package is trusted by name and no digest is compiled in. A package with no pin is
 * refused, and the refusal carries the digest Android reports for it (a public value),
 * so the owner can read it from the log and pin it.
 *
 * Shared by the media service's ControllerPolicy (media.controllerPins) and the car
 * screen's host check (car.hostPins).
 */
public final class SignerPins {
    /** Whether a caller may bind, and when not, why and what its certificate is. */
    public static final class Result {
        public final boolean allowed;
        /** Fixed text. Empty when allowed. */
        public final String reason;
        /** The package's certificate digest when it is the caller's own package and readable; else null. */
        public final String observedDigest;

        Result(boolean allowed, String reason, String observedDigest) {
            this.allowed = allowed;
            this.reason = reason;
            this.observedDigest = observedDigest;
        }
    }

    private SignerPins() { }

    /** True when the uid runs this package. */
    public static boolean owns(PackageFacts facts, int uid, String packageName) {
        String[] owned = facts.packagesForUid(uid);
        if (owned == null || packageName == null) return false;
        for (String p : owned) if (packageName.equals(p)) return true;
        return false;
    }

    /**
     * @param uid  the caller's uid as Binder reports it
     * @param pins package to lower-case SHA-256 hex of its signing certificate; null for none
     */
    public static Result check(String packageName, int uid, PackageFacts facts, Map<String, String> pins) {
        if (packageName == null || packageName.isEmpty()) return new Result(false, "the caller has no package name", null);
        if (!owns(facts, uid, packageName)) return new Result(false, "the package is not the caller's", null);
        String digest = facts.signingSha256(packageName);
        if (digest == null) return new Result(false, "the package's signing certificate cannot be read", null);
        String pin = pins == null ? null : pins.get(packageName);
        if (pin == null) return new Result(false, "no pin for this package", digest);
        if (!pin.equalsIgnoreCase(digest)) return new Result(false, "the signing certificate is not the pinned one", digest);
        return new Result(true, "", null);
    }

    /**
     * The pins as a payload last wrote them into the surface cache: a JSON object of
     * package to certificate digest. Anything that is not such an object is no pins at
     * all, and with no pin a package is refused.
     */
    public static Map<String, String> fromCache(String json) {
        if (json == null || json.isEmpty()) return Collections.emptyMap();
        try {
            JSONObject o = new JSONObject(json);
            Map<String, String> out = new HashMap<>();
            for (Iterator<String> it = o.keys(); it.hasNext(); ) {
                String pkg = it.next();
                Object digest = o.opt(pkg);
                if (!(digest instanceof String) || !((String) digest).matches("[0-9a-fA-F]{64}")) return Collections.emptyMap();
                out.put(pkg, ((String) digest).toLowerCase(Locale.ROOT));
            }
            return out;
        } catch (Exception notAnObject) {
            return Collections.emptyMap();
        }
    }
}
