package net.kckern.daylight.cap.mediaservice.shell;

/**
 * The position Now playing draws, smoothed. A player reports where it is now and then;
 * a screen's player in particular moves in one-second steps as its polls land. Between
 * reports this counts forward on its own, and when a report disagrees with what it shows
 * by less than SNAP_MS it does not jump: the difference is absorbed over
 * max(MIN_SETTLE_MS, 2 x the difference). A larger disagreement (a seek, a pause, a new
 * item) is shown at once. (JellyBox's SmoothPosition does the same.)
 *
 * <p>For drawing only: a seek is always sent from the player's own position. Pure: the
 * caller passes the time (SystemClock.elapsedRealtime()).
 */
final class PositionClock {
    static final long SNAP_MS = 1000, MIN_SETTLE_MS = 400;

    private boolean known, playing;
    private long basePosition, baseAt, lag, settle = MIN_SETTLE_MS;

    /** A report from the player: its position now, and whether it is advancing. */
    void report(long position, boolean isPlaying, long now) {
        long error = known ? at(now) - position : 0;
        boolean continues = known && isPlaying && playing && Math.abs(error) < SNAP_MS;
        lag = continues ? error : 0;
        settle = Math.max(MIN_SETTLE_MS, Math.abs(lag) * 2);
        basePosition = position;
        baseAt = now;
        playing = isPlaying;
        known = true;
    }

    /** Where to draw at {@code now}. */
    long at(long now) {
        if (!known) return 0;
        long since = Math.max(0, now - baseAt);
        long shown = basePosition + (playing ? since : 0);
        if (lag != 0 && since < settle) shown += lag * (settle - since) / settle;
        return Math.max(0, shown);
    }

    /** Forget the past: a new item, a different player. The next report is shown as it is. */
    void reset() { known = false; lag = 0; }
}
