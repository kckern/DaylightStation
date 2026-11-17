package net.kckern.daylight.cap.webviewhost;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The page bridge's tokens. Pure Java.
 *
 * The shim that defines window.daylight is injected at document start, into frames of
 * an allowed origin only, and carries one secret: the key that opens a session. With it
 * a document asks for a token of its own, and every later call presents that token.
 *
 * A token belongs to the document it was issued to. Each main-frame navigation starts
 * a new generation, and a token is refused once the document it was issued to has been
 * replaced. The start-of-navigation callback (main thread) and a new document's first
 * call (the WebView's bridge thread) can arrive in either order, so a token issued in
 * generation g is honored in g and in g+1 and never after: the new document's token
 * survives its own navigation callback arriving late, and the previous document's
 * token is dead by the navigation after next at the latest. The script context that
 * held it is destroyed when its document is replaced.
 */
final class BridgeTokens {
    /** Tokens kept at most. A page with many allowed-origin frames opens one each. */
    static final int MAX_TOKENS = 64;

    private final byte[] sessionKey;
    private final SecureRandom random = new SecureRandom();
    private final Map<String, Long> issuedIn = new LinkedHashMap<>();
    private long generation;

    BridgeTokens(String sessionKey) { this.sessionKey = sessionKey.getBytes(StandardCharsets.UTF_8); }

    /** A random 128-bit value as hex. */
    static String random(SecureRandom r) {
        byte[] b = new byte[16];
        r.nextBytes(b);
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format("%02x", x));
        return s.toString();
    }

    /** A main-frame navigation has started: the documents before the current one lose their tokens. */
    synchronized void navigated() {
        generation++;
        for (Iterator<Map.Entry<String, Long>> it = issuedIn.entrySet().iterator(); it.hasNext(); ) {
            if (generation - it.next().getValue() > 1) it.remove();
        }
    }

    /** A token for the calling document, or "" when the key is not the session key. */
    synchronized String open(String presentedKey) {
        if (presentedKey == null || !MessageDigest.isEqual(sessionKey, presentedKey.getBytes(StandardCharsets.UTF_8))) return "";
        String token = random(random);
        issuedIn.put(token, generation);
        while (issuedIn.size() > MAX_TOKENS) issuedIn.remove(issuedIn.keySet().iterator().next());
        return token;
    }

    /** Was this token issued to the current document (or the one a navigation is replacing right now)? */
    synchronized boolean valid(String token) {
        if (token == null || token.isEmpty()) return false;
        // The lookup is by the whole random value; a guess has to be right in all 128 bits.
        Long g = issuedIn.get(token);
        return g != null && generation - g <= 1;
    }
}
