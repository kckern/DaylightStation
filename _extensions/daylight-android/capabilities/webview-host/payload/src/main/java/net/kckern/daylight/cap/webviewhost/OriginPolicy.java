package net.kckern.daylight.cap.webviewhost;

import net.kckern.daylight.core.kiosk.Origins;

import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Which page origins get the bridge, the mic and the camera. Pure Java.
 * Parsing is by hand and strict: anything doubtful has no origin, and no origin is never allowed.
 */
final class OriginPolicy {
    private final Set<String> origins;

    private OriginPolicy(Set<String> origins) { this.origins = origins; }

    /** bridgeOrigins: comma-separated origins or URLs. Empty means the origin of startUrl. */
    static OriginPolicy fromSettings(String bridgeOrigins, String startUrl) {
        Set<String> out = new LinkedHashSet<>();
        if (bridgeOrigins != null) {
            for (String part : bridgeOrigins.split(",")) {
                String o = originOf(part.trim());
                if (o != null) out.add(o);
            }
        }
        if (out.isEmpty()) {
            String o = originOf(startUrl);
            if (o != null) out.add(o);
        }
        return new OriginPolicy(Collections.unmodifiableSet(out));
    }

    boolean allows(String url) {
        String o = originOf(url);
        return o != null && origins.contains(o);
    }

    /** The origins, in the form AndroidX allowedOriginRules expects ("https://host[:port]"). */
    Set<String> rules() { return origins; }

    /** "scheme://host[:port]" with default ports dropped, or null. http and https only. */
    static String originOf(String url) { return Origins.of(url); }
}
