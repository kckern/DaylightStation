package net.kckern.daylight.cap.webviewhost;

/**
 * One URL waiting for a window. A link can arrive when no kiosk Activity is up (the
 * phone's window was swiped away); the Activity that attaches next loads this in
 * place of the start page. Pure Java.
 */
final class PendingOpen {
    /** A link that led to no window within this long is forgotten. */
    static final long KEEP_MS = 60_000;

    private String url;
    private long setAt;

    synchronized void set(String url, long nowMs) {
        this.url = url;
        this.setAt = nowMs;
    }

    /** The kept URL, once, or null when there is none or it is too old. */
    synchronized String take(long nowMs) {
        String u = url;
        url = null;
        return u != null && nowMs - setAt <= KEEP_MS ? u : null;
    }
}
