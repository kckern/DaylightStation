package net.kckern.portalkeys.payload;

import org.json.JSONObject;
import org.json.JSONTokener;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * Legacy public-kiosk lockdown, served by the payload on :8773.
 *
 * Through shell 34 the shell's own PUT /lockdown (:8771) could never lock: it
 * read the body from NanoHTTPD's postData, which 2.3.1 fills only for POST, so
 * every Stop arrived empty and was taken as a release. Shell 35 fixes that, but
 * a shell needs a signed APK; a payload swap does not. This route writes the
 * same "lockdownUntil" preference the shell's key filter reads on every key
 * (0 = clear, Long.MAX_VALUE = indefinite, else a wall-clock deadline), through
 * the process-wide SharedPreferences instance, so the lock is live at once.
 *
 * Same contract as the shell route: X-Lockdown-Token header, JSON
 * {"locked":bool,"lockedUntil":ms|null}. Ordered (revisioned) commands belong to
 * the shell's protocol 2 and are refused here rather than half-applied.
 */
final class LockdownRoute {
    static final String PREFS = "portalkeys", TOKEN = "lockdownToken", UNTIL = "lockdownUntil";

    static final class Decision {
        final int status; final Long until; final String error;
        private Decision(int status, Long until, String error) { this.status=status; this.until=until; this.error=error; }
    }

    static Decision decide(String expectedToken, String suppliedToken, String body, long now) {
        if (expectedToken == null || expectedToken.isEmpty() || suppliedToken == null || !MessageDigest.isEqual(
                expectedToken.getBytes(StandardCharsets.UTF_8), suppliedToken.getBytes(StandardCharsets.UTF_8)))
            return new Decision(401, null, "unauthorized");
        JSONObject json;
        try {
            JSONTokener tokens = new JSONTokener(body == null ? "" : body);
            Object value = tokens.nextValue();
            if (!(value instanceof JSONObject) || tokens.nextClean() != 0) throw new IllegalArgumentException();
            json = (JSONObject) value;
        } catch (Exception invalid) { return new Decision(400, null, "invalid lockdown command"); }
        if (json.has("revision")) return new Decision(400, null, "ordered commands go to the shell route");
        Object locked = json.opt("locked");
        if (!(locked instanceof Boolean)) return new Decision(400, null, "invalid lockdown command");
        if (!(Boolean) locked) return new Decision(200, 0L, null);
        Object until = json.opt("lockedUntil");
        if (until == null || until == JSONObject.NULL) return new Decision(200, Long.MAX_VALUE, null);
        if (!(until instanceof Number) || ((Number) until).doubleValue() != Math.rint(((Number) until).doubleValue()))
            return new Decision(400, null, "invalid lockdown command");
        long deadline = ((Number) until).longValue();
        if (deadline <= now) return new Decision(400, null, "lockedUntil must be in the future");
        return new Decision(200, deadline, null);
    }

    static boolean active(long until, long now) { return until == Long.MAX_VALUE || until > now; }

    /** A bounded JSON body read straight off the request; null when absent or oversized. */
    static String readBody(java.util.Map<String, String> headers, java.io.InputStream in) {
        try {
            if (headers.containsKey("transfer-encoding")) return null;
            int length = Integer.parseInt(headers.get("content-length"));
            if (length < 1 || length > 1024) return null;
            byte[] bytes = new byte[length]; int read = 0;
            while (read < length) { int n = in.read(bytes, read, length - read); if (n < 0) return null; read += n; }
            return new String(bytes, StandardCharsets.UTF_8);
        } catch (Exception unreadable) { return null; }
    }
}
