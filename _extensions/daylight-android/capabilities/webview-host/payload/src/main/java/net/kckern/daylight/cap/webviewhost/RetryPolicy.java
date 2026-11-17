package net.kckern.daylight.cap.webviewhost;

/** When to try a failed page again. Pure Java. */
final class RetryPolicy {
    private RetryPolicy() { }

    /** Delay before the next retry, or -1 for none. Doubles per consecutive failure up to the ceiling. */
    static long delayMs(int consecutiveFailures, int baseSec, int maxSec) {
        if (baseSec <= 0 || consecutiveFailures <= 0) return -1;
        long delay = ((long) baseSec * 1000L) << Math.min(consecutiveFailures - 1, 10);
        long ceiling = (long) Math.max(baseSec, maxSec) * 1000L;
        return Math.min(delay, ceiling);
    }

    /**
     * Only a failed page is reloaded when the network comes back. Remounting a healthy
     * page drops Web MIDI and the bridge socket (the 2026-07-15 piano outage).
     */
    static boolean reloadOnNetworkReturn(boolean enabled, LoadTracker.State state) {
        return enabled && state == LoadTracker.State.FAILED;
    }
}
