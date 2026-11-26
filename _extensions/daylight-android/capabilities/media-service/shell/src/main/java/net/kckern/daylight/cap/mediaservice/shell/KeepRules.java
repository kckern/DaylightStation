package net.kckern.daylight.cap.mediaservice.shell;

import androidx.media3.datasource.HttpDataSource;

import java.io.IOException;
import java.net.ConnectException;
import java.net.NoRouteToHostException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.util.Locale;

/**
 * The rules downloads live by, kept pure so each is tested: when a failed track is tried
 * again, why it failed in words a person can act on, when a download has stalled, and
 * whether a byte may be fetched on the network the phone is on.
 */
final class KeepRules {
    private KeepRules() { }

    // ── retry ────────────────────────────────────────────────────────────────

    /** Waits after the 1st, 2nd, 3rd failure; every later one waits a day. */
    static final long[] RETRY_AFTER_MS = { 60_000L, 600_000L, 3_600_000L };
    static final long DAY_MS = 86_400_000L;

    /** When a track that has failed {@code attempts} times (last at {@code failedAt}) is tried again. */
    static long retryAt(int attempts, long failedAt) {
        int i = Math.max(0, attempts - 1);
        return failedAt + (i < RETRY_AFTER_MS.length ? RETRY_AFTER_MS[i] : DAY_MS);
    }

    /** A failure no retry will fix on its own (the file is gone from the library). Retry now still may. */
    static boolean permanent(int httpStatus) { return httpStatus == 404 || httpStatus == 410; }

    // ── reasons ──────────────────────────────────────────────────────────────

    static final String GONE = "Gone from the library";
    static final String REFUSED = "Home refused it";
    static final String HOME_PROBLEM = "Home had a problem";
    static final String UNREACHABLE = "Home not reachable";
    static final String FULL = "Phone full";
    static final String INCOMPLETE = "Incomplete file";
    static final String UNKNOWN = "Did not download";

    static String reasonForStatus(int status) {
        if (status == 404 || status == 410) return GONE;
        if (status == 401 || status == 403) return REFUSED;
        if (status >= 500) return HOME_PROBLEM;
        return UNKNOWN;
    }

    /** The HTTP status inside a download failure, or 0. */
    static int statusOf(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof HttpDataSource.InvalidResponseCodeException) return ((HttpDataSource.InvalidResponseCodeException) t).responseCode;
        }
        return 0;
    }

    /** Why a download failed, from its exception. */
    static String reasonFor(Throwable e) {
        int status = statusOf(e);
        if (status > 0) return reasonForStatus(status);
        for (Throwable t = e; t != null; t = t.getCause()) {
            String m = t.getMessage() == null ? "" : t.getMessage().toLowerCase(Locale.ROOT);
            if (m.contains("enospc") || m.contains("no space left")) return FULL;
            if (t instanceof UnknownHostException || t instanceof ConnectException || t instanceof NoRouteToHostException
                    || t instanceof SocketTimeoutException) return UNREACHABLE;
            if (t instanceof HttpDataSource.HttpDataSourceException && !(t instanceof HttpDataSource.InvalidResponseCodeException)) {
                return UNREACHABLE;
            }
        }
        return e instanceof IOException ? UNREACHABLE : UNKNOWN;
    }

    /** After a failure for this reason, the partial file is thrown away rather than resumed onto. */
    static boolean discardPartial(String reason) { return FULL.equals(reason) || INCOMPLETE.equals(reason); }

    // ── stalls ───────────────────────────────────────────────────────────────

    static final long STALL_MS = 30 * 60_000L;

    /**
     * A collection downloading with its requirements met whose bytes have not moved since
     * {@code lastChangeAt} for 30 minutes has stalled.
     */
    static boolean stalled(boolean downloading, boolean requirementsMet, long lastChangeAt, long now) {
        return downloading && requirementsMet && lastChangeAt > 0 && now - lastChangeAt >= STALL_MS;
    }

    // ── the network rule ─────────────────────────────────────────────────────

    /**
     * Whether a byte for a keep may be fetched now: a size check, a cover, a re-sync, a track.
     * Unmetered always; metered (mobile data, a hotspot) only when the person allowed it.
     */
    static boolean networkAllows(boolean connected, boolean metered, boolean cellularAllowed) {
        return connected && (!metered || cellularAllowed);
    }

    // ── asking first ─────────────────────────────────────────────────────────

    /** A keep bigger than a quarter of the space set for downloads is asked about once. */
    static boolean askFirst(long needBytes, long capMb) {
        return capMb > 0 && needBytes > capMb * 1_000_000L / 4;
    }
}
