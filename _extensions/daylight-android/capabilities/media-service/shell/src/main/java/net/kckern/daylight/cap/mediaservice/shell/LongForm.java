package net.kckern.daylight.cap.mediaservice.shell;

import java.util.Locale;

/**
 * What listening to a talk, a course or a book needs that music does not, after the
 * audiobookshelf app's player: a speed (music always plays at 1x), time left counted at
 * that speed, a short step back on resuming after a pause, and a sleep timer that fades
 * out instead of cutting off. Pure; the session (LongFormPolicy) and Now playing use it.
 */
final class LongForm {
    private LongForm() { }

    /** The speeds offered. Fine steps around 1x, where most listening happens. */
    static final float[] SPEEDS = { 0.8f, 0.9f, 1f, 1.1f, 1.2f, 1.3f, 1.5f, 1.7f, 2f, 2.5f, 3f };
    static final float MIN_SPEED = 0.5f, MAX_SPEED = 3f;

    /** A speed held to the range and to 0.05 steps. */
    static float clampSpeed(float s) {
        if (Float.isNaN(s) || s <= 0) return 1f;
        float c = Math.max(MIN_SPEED, Math.min(MAX_SPEED, s));
        return Math.round(c * 20f) / 20f;
    }

    /** "1×", "1.2×", "1.25×". */
    static String speedLabel(float s) {
        String n = String.format(Locale.US, "%.2f", clampSpeed(s));
        while (n.contains(".") && (n.endsWith("0") || n.endsWith("."))) n = n.substring(0, n.length() - 1);
        return n + "×";
    }

    /**
     * How far to step back when playback resumes after a pause of {@code pausedMs}, so the
     * listener hears again what they last heard (audiobookshelf's table): under 10 s none;
     * under a minute 3 s; under 5 minutes 10 s; under 30 minutes 20 s; longer, 30 s.
     */
    static long resumeRewindMs(long pausedMs) {
        if (pausedMs < 10_000) return 0;
        if (pausedMs < 60_000) return 3_000;
        if (pausedMs < 300_000) return 10_000;
        if (pausedMs < 1_800_000) return 20_000;
        return 30_000;
    }

    /** Time left as the listener will spend it: the media's remainder divided by the speed. */
    static long remainingAtSpeed(long positionMs, long durationMs, float speed) {
        long left = Math.max(0, durationMs - positionMs);
        return (long) (left / clampSpeed(speed));
    }

    static final long FADE_MS = 60_000;

    /** The sleep timer's volume with {@code remainingMs} to go: full until the last minute, then down to 10%. */
    static float fadeVolume(long remainingMs) {
        if (remainingMs >= FADE_MS) return 1f;
        float left = Math.max(0, remainingMs) / (float) FADE_MS;
        return 0.1f + 0.9f * left;
    }

    /**
     * Which collection a long item's speed is remembered for: its household list, else its
     * album (a book, a course), else none (the long-form default applies).
     */
    static String speedKey(String listId, String album) {
        if (listId != null && !listId.isEmpty()) return "list:" + listId;
        if (album != null && !album.trim().isEmpty()) return "album:" + album.trim().toLowerCase(Locale.ROOT);
        return "";
    }

    /** Where speeds are kept: per collection, and the default for long items not set yet. */
    interface SpeedMemory {
        float get(String key, float fallback);
        void put(String key, float speed);
    }

    static final String DEFAULT_KEY = "longFormSpeed";

    /**
     * The speed an item plays at: music always 1x; a long item its collection's remembered
     * speed, else the listener's latest long-form speed, else 1x.
     */
    static float speedFor(boolean longForm, String key, SpeedMemory memory) {
        if (!longForm) return 1f;
        float fallback = memory.get(DEFAULT_KEY, 1f);
        return clampSpeed(key.isEmpty() ? fallback : memory.get("speed:" + key, fallback));
    }

    /** A speed chosen for a long item: kept for its collection and as the new default. */
    static void remember(String key, float speed, SpeedMemory memory) {
        float s = clampSpeed(speed);
        if (!key.isEmpty()) memory.put("speed:" + key, s);
        memory.put(DEFAULT_KEY, s);
    }
}
