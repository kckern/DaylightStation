package net.kckern.daylight.shellkit;

/**
 * What the mini player shows for a NowPlayingNote entry (MiniPlayer): whether it is up,
 * its second line, and its Play/Pause state with a tap not yet answered. Pure.
 */
public final class MiniPlayerState {
    /** A tapped item not playing after this long is not shown as starting any more (it failed). */
    public static final long STARTING_MS = 30_000;

    private MiniPlayerState() { }

    /** The identity of what the bar shows: a swipe-down hides that item on this screen until the next one. */
    public static String key(NowPlayingNote.Entry e) { return e == null ? "" : e.target + "|" + e.title; }

    /** Whether the bar is up for {@code e} at {@code now}, with {@code dismissed} the key swiped away here. */
    public static boolean shown(NowPlayingNote.Entry e, String dismissed, long now) {
        if (e == null || e.title.isEmpty()) return false;
        if (e.starting && now - e.reportedAt > STARTING_MS) return false;
        return !key(e).equals(dismissed);
    }

    /**
     * Whether a browse screen wakes the media service as it shows: when this phone has no
     * entry and a queue was saved. Android stops a paused media service about a minute after
     * the app goes to the background (2026-11-27: the owner came back from Plexamp to an
     * album page with no bar while Spindrift sat paused); woken, the service restores the
     * queue, paused, and reports it, so a paused item always has the bar.
     */
    public static boolean wake(NowPlayingNote.Entry local, boolean savedQueue) {
        return local == null && savedQueue;
    }

    /** "Starting…"; the chapter; "On <screen>" for a screen; else the by-line. */
    public static String line(NowPlayingNote.Entry e) {
        if (e == null) return "";
        if (e.starting) return NowPlayingNote.STARTING_TITLE.equals(e.title) ? "" : "Starting…";
        boolean screen = !"local".equals(e.target);
        if (screen) return "On " + (e.targetName.isEmpty() ? "a screen" : e.targetName);
        return e.detail.isEmpty() ? e.artist : e.detail;
    }

    /**
     * Playing as the bar shows it: a tap flips it at once and the player's next report
     * corrects it. {@code pressedAt} is when Play/Pause was tapped (-1 for none); the flip
     * stands until a report newer than the tap arrives.
     */
    public static boolean playing(NowPlayingNote.Entry e, long pressedAt, boolean flipped) {
        if (e == null) return false;
        if (pressedAt >= 0 && e.reportedAt < pressedAt) return flipped;
        return e.playing;
    }
}
