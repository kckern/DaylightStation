package net.kckern.daylight.cap.onetap.shell;

import java.util.regex.Pattern;

/** What the pin confirmation hands the payload. Pure. */
final class PinConfirmation {
    /** OneTapActionsCapability.PIN_PORT. */
    static final String PORT = "pins";
    /** AndroidSurfaces.EXTRA_TOKEN. */
    static final String EXTRA_TOKEN = "token";
    /** The payload's tokens: 16 random bytes as lower-case hex. */
    private static final Pattern TOKEN = Pattern.compile("[0-9a-f]{32}");

    private PinConfirmation() { }

    /** The port request for a token of the payload's shape; null for anything else. */
    static String request(String token) {
        if (token == null || !TOKEN.matcher(token).matches()) return null;
        return "{\"op\":\"confirmed\",\"token\":\"" + token + "\"}";
    }
}
