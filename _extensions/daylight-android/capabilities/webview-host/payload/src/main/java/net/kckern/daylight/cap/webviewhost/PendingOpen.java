package net.kckern.daylight.cap.webviewhost;

/**
 * One URL waiting for a window. A link can arrive when no kiosk Activity is up (the
 * phone's window was swiped away); the Activity that attaches next loads this in
 * place of the start page. Pure Java.
 */
final class PendingOpen {
    /** A link that led to no window within this long is forgotten. */
    static final long KEEP_MS = 60_000;

    static final class Request {
        final String url, loadId;
        final long setAt;
        final boolean outside, shortcut;

        Request(String url, String loadId, long setAt, boolean outside, boolean shortcut) {
            this.url = url;
            this.loadId = loadId;
            this.setAt = setAt;
            this.outside = outside;
            this.shortcut = shortcut;
        }
    }

    private Request pending;

    synchronized void set(String url, String loadId, long nowMs) { pending = new Request(url, loadId, nowMs, false, false); }

    synchronized void set(String url, String loadId, long nowMs, boolean fromOutside) {
        pending = new Request(url, loadId, nowMs, fromOutside, true);
    }

    /** Consume the complete launch together, including where it came from. */
    synchronized Request takeRequest(long nowMs) {
        Request request = pending;
        pending = null;
        return request != null && nowMs - request.setAt <= KEEP_MS ? request : null;
    }
}
