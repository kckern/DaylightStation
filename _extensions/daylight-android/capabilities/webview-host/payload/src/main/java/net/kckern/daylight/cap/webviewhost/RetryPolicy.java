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

    /** A page-initiated navigation that keeps failing is given up after this many failures in a row. */
    static final int GIVE_UP_AFTER = 3;

    /**
     * Should the kiosk stop retrying this URL and go back to its start page? Yes for a
     * URL that is not the start page and has failed GIVE_UP_AFTER times in a row. A page
     * that navigated to an address that does not answer used to strand the kiosk there:
     * that address became the one to retry, for ever, and Back in reload mode reloaded it.
     * The start page itself is retried for as long as it takes.
     */
    static boolean abandonForStart(int consecutiveFailures, String failedUrl, String startUrl) {
        if (consecutiveFailures < GIVE_UP_AFTER) return false;
        if (startUrl == null || startUrl.trim().isEmpty() || failedUrl == null) return false;
        return !sameAddress(failedUrl, startUrl);
    }

    /** The same page, ignoring a fragment and a trailing slash. */
    static boolean sameAddress(String a, String b) {
        return normal(a).equals(normal(b));
    }

    private static String normal(String url) {
        String s = url.trim();
        int hash = s.indexOf('#');
        if (hash >= 0) s = s.substring(0, hash);
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return s;
    }
}
