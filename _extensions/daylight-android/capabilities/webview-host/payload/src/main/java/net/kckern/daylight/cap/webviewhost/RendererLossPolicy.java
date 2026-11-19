package net.kckern.daylight.cap.webviewhost;

/**
 * What to do when the page's renderer process dies. Pure Java; the clock is passed in.
 *
 * A renderer that dies once is rebuilt and the page reloaded at once. A page that
 * kills its renderer every time it loads (the Portal has a recorded V8 out-of-memory
 * loop) used to be rebuilt and reloaded at once, for ever. Here a loss that follows the
 * last one within the window adds to a count that a successful load does NOT clear:
 * the page loading is exactly what precedes the crash. The count clears only when the
 * renderer has stayed alive for the whole window.
 */
final class RendererLossPolicy {
    /** A renderer that has been alive this long since its page was last loaded starts a new count. */
    static final long WINDOW_MS = 5 * 60_000L;
    /** From this many losses in a row the kiosk shows its own error page and retries slowly. */
    static final int GIVE_UP_AFTER = 3;

    static final class Action {
        /** Losses in a row, this one included. */
        final int count;
        /** How long to wait before loading the page again; 0 loads it at once. */
        final long delayMs;
        /** Show the local error page while waiting. */
        final boolean showErrorPage;
        Action(int count, long delayMs, boolean showErrorPage) {
            this.count = count;
            this.delayMs = delayMs;
            this.showErrorPage = showErrorPage;
        }
    }

    private int count;
    /** When the page is loaded again after the last loss: the renderer's new life starts here. */
    private long resumeAtMs;
    private int total;

    /**
     * The renderer died.
     * @param baseSec recovery.reloadOnPageFailureSec; 0 or less is treated as 1, because a
     *                renderer loop must be slowed even where page retries are switched off
     * @param maxSec  recovery.maxRetrySec
     */
    synchronized Action lost(long nowMs, int baseSec, int maxSec) {
        // The window is the renderer's time alive, measured from when the page was loaded
        // again and not from the loss: a reload that waits five minutes and then crashes
        // in seconds is the same loop.
        if (count > 0 && nowMs - resumeAtMs > WINDOW_MS) count = 0;
        count++;
        total++;
        if (count == 1) {
            resumeAtMs = nowMs;
            return new Action(count, 0, false);
        }
        int base = Math.max(1, baseSec);
        long delay = count >= GIVE_UP_AFTER
                ? (long) Math.max(base, maxSec) * 1000L                      // the slow schedule
                : RetryPolicy.delayMs(count - 1, base, Math.max(base, maxSec));
        resumeAtMs = nowMs + delay;
        return new Action(count, delay, true);
    }

    /** Losses in a row as of now: 0 once the renderer has outlived the window. */
    synchronized int consecutive(long nowMs) {
        return count > 0 && nowMs - resumeAtMs > WINDOW_MS ? 0 : count;
    }

    /** Every loss since the payload started. */
    synchronized int total() { return total; }
}
