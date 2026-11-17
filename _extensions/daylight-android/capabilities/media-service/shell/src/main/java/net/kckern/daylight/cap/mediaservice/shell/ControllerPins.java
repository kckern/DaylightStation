package net.kckern.daylight.cap.mediaservice.shell;

import org.json.JSONObject;

import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;

/**
 * The pinned controllers, as the payload last wrote them into the surface cache (the
 * setting media.controllerPins, as a JSON object of package to certificate digest).
 * Read from the cache so that a car that binds the service in a process with no
 * payload is still held to the pins. Pure. Anything that is not such an object is no
 * pins at all, and with no pin a package is refused.
 */
final class ControllerPins {
    /** The key in the preferences file SurfaceKeys.PREFS. The payload spells it the same way. */
    static final String KEY = "media.controllerPins";

    private ControllerPins() { }

    static Map<String, String> fromCache(String json) {
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
