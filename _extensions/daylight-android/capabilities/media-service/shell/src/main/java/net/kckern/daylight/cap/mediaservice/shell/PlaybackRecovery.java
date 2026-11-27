package net.kckern.daylight.cap.mediaservice.shell;

import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;

/**
 * What the phone's player does after a playback error on a streamed item. Pure: the
 * service passes in the error code, the HTTP status (or -1) and whether the item is
 * kept on this phone, and acts on the answer.
 *
 * <ul>
 *   <li>The item itself will not play (a decode or format error, a 404 or 410 for it):
 *       skip to the next item, at most {@link #MAX_SKIPS} in a row, then stop on the
 *       item and say so. One item that plays resets the count.</li>
 *   <li>Home cannot be reached (connection failed or timed out, a 5xx, a 401/403/408/429):
 *       stay on the item at its position, show {@link #LOST}, and prepare again after
 *       2, 5, 10 and 30 s, then every 30 s while the session lives. The player keeps
 *       playWhenReady through an error, so a retry that works plays on where it was.</li>
 * </ul>
 *
 * Before this, every error skipped, so with home unreachable a queue ran to its end
 * (up to 500 items) in seconds and the place was lost; see
 * ops:docs/_wip/audits/2026-11-26-phone-liminal-states-audit.md (H2).
 */
final class PlaybackRecovery {
    enum Action { SKIP, HOLD, STOP }

    static final int MAX_SKIPS = 3;
    static final long[] RETRY_MS = { 2_000, 5_000, 10_000, 30_000 };
    static final String LOST = "Lost connection to home · will resume";
    static final String WONT_PLAY = "This item won't play";

    /** The line Now playing shows for this phone's player error; "" when none is set. */
    private static volatile String shown = "";

    private int skips;
    private int retries;

    /** The status line for the current error, as the service last set it. */
    static String statusNow() { return shown; }

    /** True when the error means home could not be reached, not that the item is bad. */
    static boolean isNetwork(int code, int httpStatus) {
        switch (code) {
            case PlaybackException.ERROR_CODE_IO_UNSPECIFIED:
            case PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED:
            case PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT:
                return true;
            case PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS:
                return httpStatus < 0 || httpStatus >= 500 || httpStatus == 401 || httpStatus == 403
                        || httpStatus == 408 || httpStatus == 429;
            default:
                return false;
        }
    }

    /**
     * The next step after an error. {@code kept}: the item plays from this phone, so an
     * IO error is the file's, never the network's. {@code playing}: the person wanted it
     * playing (playWhenReady); a paused item is never skipped past.
     */
    Action onError(int code, int httpStatus, boolean kept, boolean playing, boolean hasNext) {
        if (!kept && isNetwork(code, httpStatus)) {
            shown = LOST;
            return Action.HOLD;
        }
        if (playing && hasNext && skips < MAX_SKIPS) {
            skips++;
            shown = WONT_PLAY;
            return Action.SKIP;
        }
        shown = skips >= MAX_SKIPS ? stoppedLine(skips) : WONT_PLAY;
        return Action.STOP;
    }

    /** "This item won't play · 3 in a row didn't, so playback stopped". */
    static String stoppedLine(int skipped) {
        return WONT_PLAY + " · " + skipped + " in a row didn't, so playback stopped";
    }

    /** The wait before the next retry of a held item; counts the retry. */
    long nextRetryMs() { return retryDelayMs(retries++); }

    /** 2, 5, 10, 30 s, then 30 s for good. */
    static long retryDelayMs(int attempt) {
        if (attempt < 0) attempt = 0;
        return RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)];
    }

    /** Something played: the counts and the line start again. */
    void played() {
        skips = 0;
        retries = 0;
        shown = "";
    }

    /** The person picked another item or another list: retries start again, skips stand. */
    void moved() {
        retries = 0;
        if (LOST.equals(shown)) shown = "";
    }

    /** The service is going: no line is left behind for a later Now playing. */
    void release() {
        played();
    }

    int skips() { return skips; }

    /**
     * Whether a playback state ends the sleep timer. ENDED does. IDLE does only when the
     * person stopped playback: an error also leaves the player IDLE, and a network drop
     * that recovers must keep the timer.
     */
    static boolean endsSleepTimer(int state, boolean playerError) {
        if (state == Player.STATE_ENDED) return true;
        return state == Player.STATE_IDLE && !playerError;
    }
}
