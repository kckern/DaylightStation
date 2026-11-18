package net.kckern.daylight.cap.notifications;

/**
 * Decides which refused links are written to the durable shell log. Any app or web
 * page can send links as fast as it likes; the log must not become what it fills.
 * A few per minute are written, the rest are counted and the count is written with
 * the first refusal of the next minute.
 */
final class RefusalLog {
    private static final long WINDOW_MS = 60_000;
    private static final int PER_WINDOW = 3;

    private long windowStart;
    private int written;
    private int dropped;

    /** The line to write for this refusal, or null to write nothing. */
    synchronized String line(String reason, long nowMs) {
        if (nowMs - windowStart >= WINDOW_MS) {
            windowStart = nowMs;
            written = 0;
        }
        if (written >= PER_WINDOW) {
            dropped++;
            return null;
        }
        written++;
        String line = "refused: " + reason;
        if (dropped > 0) {
            line += " (" + dropped + " earlier refusals not logged)";
            dropped = 0;
        }
        return line;
    }
}
