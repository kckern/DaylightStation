package net.kckern.daylight.core;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Every control API request must present the device token in this header. */
public final class Auth {
    /** NanoHTTPD lower-cases header names. */
    public static final String HEADER = "x-daylight-token";
    private static final int MIN_LENGTH = 32;

    private final byte[] expected;

    public Auth(String token) {
        if (token == null || token.length() < MIN_LENGTH) {
            throw new IllegalArgumentException("control token is missing or shorter than " + MIN_LENGTH + " characters");
        }
        this.expected = token.getBytes(StandardCharsets.UTF_8);
    }

    public boolean accepts(String presented) {
        if (presented == null) return false;
        return MessageDigest.isEqual(expected, presented.getBytes(StandardCharsets.UTF_8));
    }
}
