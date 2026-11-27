package net.kckern.daylight.cap.mediaservice.shell;

/**
 * When a transition between two songs fades, and how (spec:
 * ops:docs/superpowers/specs/2026-11-26-phone-crossfade.md). Pure: no Android, no player.
 *
 * Music only; never inside a record played in order; never across a short track; never
 * when a sleep timer is set; never planned so late that the outgoing copy cannot be ready.
 */
final class Crossfade {
    private Crossfade() { }

    static final int DEFAULT_SEC = 4;
    static final int MAX_SEC = 12;
    /** The choices offered in Now playing's menu, seconds (0 = off). */
    static final int[] CHOICES = { 0, 2, 4, 6, 8, 12 };
    /** Time before the fade point the outgoing copy is prepared. */
    static final long PREPARE_AHEAD_MS = 15_000;
    /** The least time before the fade point a plan may still be made (the copy must get ready). */
    static final long LEAD_MS = 2_500;
    /** A manual skip's short fade-out, so the cut does not click. */
    static final long CUT_MS = 150;
    /** Ramp steps a second while a fade runs. */
    static final int STEPS_PER_SEC = 25;

    /** Why a transition does not fade. */
    enum Skip { OFF, LONG_FORM, NO_NEXT, REPEAT_ONE, IN_ORDER_ALBUM, SHORT_TRACK, SLEEP_TIMER, TOO_LATE, UNKNOWN_LENGTH }

    /** One side of a transition, as the queue describes it. */
    static final class Side {
        final boolean longForm;
        final long durationMs;
        final String album;
        final String artist;

        Side(boolean longForm, long durationMs, String album, String artist) {
            this.longForm = longForm;
            this.durationMs = durationMs;
            this.album = album == null ? "" : album.trim();
            this.artist = artist == null ? "" : artist.trim();
        }
    }

    /** A plan: fade at {@code startMs} into the current item for {@code fadeMs}, or a reason not to. */
    static final class Plan {
        final Skip skip;
        final long fadeMs;
        final long startMs;

        private Plan(Skip skip, long fadeMs, long startMs) {
            this.skip = skip;
            this.fadeMs = fadeMs;
            this.startMs = startMs;
        }

        boolean fades() { return skip == null; }

        static Plan no(Skip why) { return new Plan(why, 0, -1); }

        @Override public String toString() {
            return fades() ? "fade " + fadeMs + " ms at " + startMs + " ms" : "no fade: " + skip.name().toLowerCase(java.util.Locale.ROOT);
        }
    }

    /**
     * Whether a side is long-form for crossfade: a book's part, a talk or a lecture by its kind
     * (home calls it resumable), however short; or by its household list or its length.
     */
    static boolean longForm(boolean kindLongForm, String listId, long durationMs) {
        return kindLongForm || CarControls.longForm(listId, durationMs);
    }

    /** The seconds in force: the person's choice when made, else the device default, clamped. */
    static int seconds(Integer chosen, Integer deviceDefault) {
        int s = chosen != null ? chosen : deviceDefault != null ? deviceDefault : DEFAULT_SEC;
        return Math.max(0, Math.min(MAX_SEC, s));
    }

    /**
     * The plan for the transition out of {@code current} into {@code next}.
     *
     * @param next       null at the end of the queue
     * @param shuffle    shuffle mode is on
     * @param repeatOne  repeat-one is on
     * @param sleepTimer a sleep timer is set (minutes or end of item)
     * @param positionMs where the current item is now
     */
    static Plan plan(int seconds, Side current, Side next, boolean shuffle, boolean repeatOne,
                     boolean sleepTimer, long positionMs) {
        if (seconds <= 0) return Plan.no(Skip.OFF);
        if (repeatOne) return Plan.no(Skip.REPEAT_ONE);
        if (next == null) return Plan.no(Skip.NO_NEXT);
        if (current.longForm || next.longForm) return Plan.no(Skip.LONG_FORM);
        if (sleepTimer) return Plan.no(Skip.SLEEP_TIMER);
        if (!shuffle && sameRecord(current, next)) return Plan.no(Skip.IN_ORDER_ALBUM);
        long fadeMs = seconds * 1000L;
        if (current.durationMs <= 0 || next.durationMs <= 0) return Plan.no(Skip.UNKNOWN_LENGTH);
        if (current.durationMs < 2 * fadeMs || next.durationMs < 2 * fadeMs) return Plan.no(Skip.SHORT_TRACK);
        long start = current.durationMs - fadeMs;
        if (positionMs > start - LEAD_MS) return Plan.no(Skip.TOO_LATE);
        return new Plan(null, fadeMs, start);
    }

    /** Two tracks from the same record: the same album title and artist (both known). */
    static boolean sameRecord(Side a, Side b) {
        return !a.album.isEmpty() && a.album.equalsIgnoreCase(b.album) && a.artist.equalsIgnoreCase(b.artist);
    }

    /** How far through a fade, 0..1. */
    static float progress(long elapsedMs, long fadeMs) {
        if (fadeMs <= 0) return 1f;
        return (float) Math.max(0, Math.min(1, elapsedMs / (double) fadeMs));
    }

    /** Equal-power fade-out gain at progress p (1 → 0). */
    static float outGain(float p) {
        return (float) Math.cos(clamp(p) * Math.PI / 2);
    }

    /** Equal-power fade-in gain at progress p (0 → 1). */
    static float inGain(float p) {
        return (float) Math.sin(clamp(p) * Math.PI / 2);
    }

    /** A manual skip's fade-out gain (linear over CUT_MS). */
    static float cutGain(long elapsedMs) {
        return 1f - progress(elapsedMs, CUT_MS);
    }

    /** Where the outgoing copy should be prepared: never before now. */
    static long prepareAtMs(Plan plan, long positionMs) {
        return Math.max(positionMs, plan.startMs - PREPARE_AHEAD_MS);
    }

    /** The most start-up delay the copy is placed ahead by. */
    static final long MAX_LEAD_MS = 400;

    /**
     * The next start-up estimate: {@code behind} is how far the copy lagged the song's own
     * time with {@code lead} already applied; half the old estimate, half the new, clamped.
     */
    static long nextLead(long lead, long behind) {
        long measured = lead + behind;
        long next = Math.round(lead * 0.5 + measured * 0.5);
        return Math.max(0, Math.min(MAX_LEAD_MS, next));
    }

    private static float clamp(float p) {
        return Math.max(0f, Math.min(1f, p));
    }
}
