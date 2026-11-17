package net.kckern.daylight.cap.lockdown;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** The hidden way out: seven quick taps in the top-left corner, then a PIN. Pure Java. */
final class ExitGesture {
    static final int TAPS = 7;
    static final long GAP_MS = 600L;
    /** The corner is this fraction of the width and of the height. */
    static final double CORNER = 0.15;
    static final int MAX_WRONG = 5;
    static final long LOCKOUT_MS = 5 * 60 * 1000L;

    enum Pin { OK, WRONG, LOCKED_OUT, DISABLED }

    private int taps;
    private long lastTapAtMs;
    private int wrong;
    private long lockedOutUntilMs;

    /** True when this touch completes the sequence. */
    synchronized boolean tap(float x, float y, int width, int height, long nowMs) {
        boolean inCorner = width > 0 && height > 0 && x <= width * CORNER && y <= height * CORNER;
        if (!inCorner) { taps = 0; return false; }
        taps = (taps > 0 && nowMs - lastTapAtMs <= GAP_MS) ? taps + 1 : 1;
        lastTapAtMs = nowMs;
        if (taps >= TAPS) { taps = 0; return true; }
        return false;
    }

    /** When the current lockout ends, or 0 when there has been none. Wrong attempts are counted in memory only. */
    synchronized long lockedOutUntilMs() { return lockedOutUntilMs; }

    /** The PIN is never logged, here or by the caller: only the result is. */
    synchronized Pin attempt(String entered, String pin, long nowMs) {
        if (pin == null || pin.isEmpty()) return Pin.DISABLED;
        if (nowMs < lockedOutUntilMs) return Pin.LOCKED_OUT;
        if (entered != null && sameText(entered, pin)) { wrong = 0; return Pin.OK; }
        if (++wrong >= MAX_WRONG) { wrong = 0; lockedOutUntilMs = nowMs + LOCKOUT_MS; }
        return Pin.WRONG;
    }

    /**
     * Compares digests, not the texts: the digests have one length whatever was typed,
     * so the time taken says nothing about the PIN's length or how much of it matched.
     */
    static boolean sameText(String a, String b) {
        try {
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            byte[] da = sha.digest(a.getBytes(StandardCharsets.UTF_8));
            byte[] db = sha.digest(b.getBytes(StandardCharsets.UTF_8));
            return MessageDigest.isEqual(da, db);
        } catch (Exception e) {
            return false;       // no digest, no match
        }
    }
}
