package net.kckern.daylight.shellkit;

import java.util.ArrayDeque;
import java.util.Locale;

/**
 * Live progress of one downloading item, from byte counts sampled once a second (2026-11-27:
 * "no progress bar within each item" and a download that "stalled"). The rate is over the last
 * few seconds. No new bytes for 15 s (45 s before the first byte) while the network is usable is a stall; the first time it
 * is seen the download is restarted (one restart per stall), and if the bytes still do not
 * come 15 s later the line says it waits for the connection. Pure; the manager's own index is
 * never read for this (it is written every 5 s).
 */
public final class DownloadProgress {
    public static final long STALL_MS = 15_000;
    /** How long a restart gets to bring bytes before the line says it waits. */
    public static final long RESTART_WAIT_MS = 15_000;
    /** An item that has not had its first byte yet is still setting up a connection (cold, slow networks): it gets longer. */
    public static final long FIRST_BYTE_MS = 45_000;
    static final long WINDOW_MS = 5_000;

    /** Moving (or just quiet), stalled and being restarted, stalled and waiting for the connection. */
    public enum Phase { MOVING, RESTARTING, WAITING }

    private final ArrayDeque<long[]> samples = new ArrayDeque<>();
    private long lastBytes = -1, mostBytes = -1, lastChangeAt = -1, restartedAt = -1;

    /** The item's bytes so far at {@code nowMs}. A count that went down (a restart) starts the rate over. */
    public synchronized void sample(long nowMs, long bytes) {
        if (bytes < lastBytes) samples.clear();
        lastBytes = bytes;
        // Only bytes past the most seen are progress: a restart that re-reads a part, or a count
        // that dips and climbs back, is not a transfer moving.
        if (bytes > mostBytes) { mostBytes = bytes; lastChangeAt = nowMs; restartedAt = -1; }
        samples.addLast(new long[] { nowMs, bytes });
        while (samples.size() > 2 && nowMs - samples.peekFirst()[0] > WINDOW_MS) samples.removeFirst();
    }

    /** Bytes a second over the window; 0 with fewer than two samples. */
    public synchronized long bytesPerSecond() {
        if (samples.size() < 2) return 0;
        long[] a = samples.peekFirst(), b = samples.peekLast();
        long dt = b[0] - a[0];
        return dt <= 0 ? 0 : Math.max(0, (b[1] - a[1]) * 1000 / dt);
    }

    private long limit() { return mostBytes > 0 ? STALL_MS : FIRST_BYTE_MS; }

    public synchronized Phase phase(long nowMs) {
        if (lastChangeAt < 0 || nowMs - lastChangeAt < limit()) return Phase.MOVING;
        return restartedAt >= 0 && nowMs - restartedAt >= RESTART_WAIT_MS ? Phase.WAITING : Phase.RESTARTING;
    }

    /** True once per stall: the moment to restart the transfer. Bytes coming again re-arm it. */
    public synchronized boolean restartDue(long nowMs) {
        if (lastChangeAt < 0 || nowMs - lastChangeAt < limit() || restartedAt >= 0) return false;
        restartedAt = nowMs;
        return true;
    }

    /**
     * The row's words: "12.4 of 40.1 MB · 1.2 MB/s"; "12.4 MB · 1.2 MB/s" when the total is not
     * known (never a percentage); "Downloading…" before the first byte of an unknown total.
     */
    public static String line(long bytes, long total, long bytesPerSecond, Phase phase) {
        boolean known = total > 0;
        if (!known && bytes <= 0 && phase == Phase.MOVING) return "Downloading…";
        String size = known ? mb(bytes) + " of " + mb(total) + " MB" : mb(bytes) + " MB";
        switch (phase) {
            case RESTARTING: return size + " · Stalled · restarting";
            case WAITING: return size + " · Stalled · will retry when the connection improves";
            default: break;
        }
        return bytesPerSecond <= 0 ? size : size + " · " + rate(bytesPerSecond);
    }

    /** "1.2 MB/s", "640 KB/s". */
    public static String rate(long bytesPerSecond) {
        if (bytesPerSecond >= 1_000_000) return mb(bytesPerSecond) + " MB/s";
        return Math.max(1, Math.round(bytesPerSecond / 1000.0)) + " KB/s";
    }

    /** Megabytes (10^6, as KeptIndex.size) to one decimal, a dot in every locale. */
    static String mb(long bytes) {
        return String.format(Locale.US, "%.1f", Math.max(0, bytes) / 1_000_000.0);
    }
}
