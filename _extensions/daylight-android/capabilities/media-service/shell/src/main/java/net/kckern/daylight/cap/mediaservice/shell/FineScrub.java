package net.kckern.daylight.cap.mediaservice.shell;

/**
 * Fine scrubbing for long items (the audiobook players' and YouTube's press-and-hold):
 * the seek bar zooms to a window around the finger, so a 5-hour book moves seconds per
 * pixel instead of a quarter-minute. The window is a tenth of the length, between 2 and 10
 * minutes; an item too short to gain from it (under three windows) is not zoomed. Pure.
 */
final class FineScrub {
    static final long MIN_WINDOW_MS = 2 * 60_000, MAX_WINDOW_MS = 10 * 60_000;

    private FineScrub() { }

    /** The window's length for an item of {@code durationMs}, or 0 when it is not worth zooming. */
    static long windowMs(long durationMs) {
        if (durationMs <= 0) return 0;
        long w = Math.max(MIN_WINDOW_MS, Math.min(MAX_WINDOW_MS, durationMs / 10));
        return durationMs >= 3 * w ? w : 0;
    }

    /** {start, end} as fractions of the item, centred on {@code at} and kept inside it. */
    static float[] window(long durationMs, float at) {
        long w = windowMs(durationMs);
        if (w == 0) return new float[] { 0f, 1f };
        float span = w / (float) durationMs;
        float start = Math.max(0f, Math.min(1f - span, at - span / 2f));
        return new float[] { start, start + span };
    }

    /** Where a finger at {@code x} (0..1 across the bar) lands, as a fraction of the item. */
    static float map(float x, float[] window) {
        float c = Math.max(0f, Math.min(1f, x));
        return window[0] + c * (window[1] - window[0]);
    }
}
