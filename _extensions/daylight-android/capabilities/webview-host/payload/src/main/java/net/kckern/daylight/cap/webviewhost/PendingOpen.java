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
    private String loadId;
    private long setAt;
    private boolean outside;

    synchronized void set(String url, long nowMs) { set(url, null, nowMs, false); }

    synchronized void set(String url, String loadId, long nowMs) { set(url, loadId, nowMs, false); }

    /**
     * Keep one URL, replacing any that was waiting: the latest wins, so what waits is
     * bounded at one. loadId is the id the caller was given for this load, or null.
     * fromOutside: the URL came from a link that did not carry the install key (see
     * DocumentTrust).
     */
    synchronized void set(String url, String loadId, long nowMs, boolean fromOutside) {
        this.url = url;
        this.loadId = loadId;
        this.setAt = nowMs;
        this.outside = fromOutside;
    }

    /** Whether the URL take() returns next came from outside the app. Read before take(). */
    synchronized boolean fromOutside() { return url != null && outside; }

    /** The id that goes with the URL take() returns next, or null. Read before take(). */
    synchronized String loadId() { return loadId; }

    /** The kept URL, once, or null when there is none or it is too old. */
    synchronized String take(long nowMs) {
        String u = url;
        url = null;
        loadId = null;
        outside = false;
        return u != null && nowMs - setAt <= KEEP_MS ? u : null;
    }
}
