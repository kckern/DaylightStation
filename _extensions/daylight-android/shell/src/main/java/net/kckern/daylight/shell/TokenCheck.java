package net.kckern.daylight.shell;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Lifeline auth. The shell cannot use core's Auth: core lives in the payload. */
final class TokenCheck {
    private TokenCheck() { }

    static boolean accepts(String expected, String presented) {
        if (expected == null || expected.length() < 32 || presented == null) return false;
        return MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),
                presented.getBytes(StandardCharsets.UTF_8));
    }
}
