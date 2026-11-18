package net.kckern.daylight.cap.mediaservice.shell;

import net.kckern.daylight.shellkit.SignerPins;

import java.util.Map;

/**
 * The pinned controllers, as the payload last wrote them into the surface cache (the
 * setting media.controllerPins, as a JSON object of package to certificate digest).
 * Read from the cache so that a car that binds the service in a process with no
 * payload is still held to the pins. Anything that is not such an object is no pins
 * at all, and with no pin a package is refused (SignerPins.fromCache).
 */
final class ControllerPins {
    /** The key in the preferences file SurfaceKeys.PREFS. The payload spells it the same way. */
    static final String KEY = "media.controllerPins";

    private ControllerPins() { }

    static Map<String, String> fromCache(String json) { return SignerPins.fromCache(json); }
}
