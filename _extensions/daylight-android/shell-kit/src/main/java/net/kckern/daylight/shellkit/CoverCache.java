package net.kckern.daylight.shellkit;

import java.util.Set;

/**
 * The rules of PlaylistArtwork's memory cache and its retry backoff, with no Android in
 * them: how a cover is keyed (its URL and the size it was decoded at), which cached size
 * answers a request, how big the cache may grow, and when a cover that failed is tried
 * again.
 */
final class CoverCache {
    /** At most this much memory holds covers, however much the app may use. */
    static final int CAP_BYTES = 32 * 1024 * 1024;
    /** Covers that failed wait a minute, doubling to a day. */
    static final long RETRY_MIN_MS = 60_000L, RETRY_MAX_MS = 86_400_000L;

    private CoverCache() { }

    /** An eighth of what this process may use, at most {@link #CAP_BYTES}, at least 4 MB. */
    static int budgetBytes(long maxMemory) {
        long eighth = maxMemory <= 0 ? CAP_BYTES : maxMemory / 8;
        return (int) Math.max(4L * 1024 * 1024, Math.min(CAP_BYTES, eighth));
    }

    /**
     * The size a request is stored under. Requests are rounded up to a few steps, so the
     * 144 of a row and the 160 of a mini player share one copy and the cache is not filled
     * with near-identical bitmaps.
     */
    static int bucket(int maxSide) {
        int[] steps = { 160, 360, 600, 900 };
        for (int s : steps) if (maxSide <= s) return s;
        return maxSide;
    }

    static String key(String url, int size) { return size + "@" + url; }

    /** The URL and size of a key, or null when it is not one. */
    static String[] split(String key) {
        int at = key == null ? -1 : key.indexOf('@');
        if (at <= 0) return null;
        String size = key.substring(0, at);
        for (int i = 0; i < size.length(); i++) if (!Character.isDigit(size.charAt(i))) return null;
        return new String[] { key.substring(at + 1), size };
    }

    /**
     * Which cached size answers a request for {@code maxSide}: the smallest at least as large
     * as its bucket (it scales down without loss). With {@code anySize}, the largest there is
     * when none is large enough, to draw at once while the full one decodes. Null for none.
     */
    static Integer pick(Set<Integer> sizes, int maxSide, boolean anySize) {
        if (sizes == null || sizes.isEmpty()) return null;
        int want = bucket(maxSide);
        Integer best = null, largest = null;
        for (Integer s : sizes) {
            if (s == null) continue;
            if (s >= want && (best == null || s < best)) best = s;
            if (largest == null || s > largest) largest = s;
        }
        return best != null ? best : anySize ? largest : null;
    }

    /** When a cover that failed {@code failures} times (last at {@code at}) may be tried again. */
    static long nextTry(int failures, long at) {
        long wait = RETRY_MIN_MS << Math.min(20, Math.max(0, failures - 1));
        return at + Math.min(RETRY_MAX_MS, wait);
    }

    /** Whether a cover with this failure record ({failures, lastAt}, or null) may be fetched now. */
    static boolean mayTry(long[] failed, long now) {
        // A failure stamped in the future (the clock moved back) counts from now.
        return failed == null || now >= nextTry((int) failed[0], Math.min(failed[1], now));
    }

    /** The record after one more failure at {@code now}. */
    static long[] failedAgain(long[] failed, long now) {
        return new long[] { failed == null ? 1 : failed[0] + 1, now };
    }
}
