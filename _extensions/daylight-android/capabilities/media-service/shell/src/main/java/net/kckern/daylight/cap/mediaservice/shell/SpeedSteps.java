package net.kckern.daylight.cap.mediaservice.shell;

/**
 * The speed sheet's arithmetic (design sweep D19): a slider from 0.5× to 3× in 0.05 steps,
 * − and + by 0.1, a haptic tick at each quarter (1×, 1.25×, 1.5×…), and five presets as
 * plain text targets, the current one checked. Pure.
 */
final class SpeedSteps {
    private SpeedSteps() { }

    static final float MIN = LongForm.MIN_SPEED, MAX = LongForm.MAX_SPEED, STEP = 0.05f, NUDGE = 0.1f;
    static final float[] PRESETS = { 1f, 1.25f, 1.5f, 1.75f, 2f };
    /** The slider's positions: 0 is 0.5×, {@link #MAX_INDEX} is 3×. */
    static final int MAX_INDEX = Math.round((MAX - MIN) / STEP);

    static int index(float speed) { return Math.round((LongForm.clampSpeed(speed) - MIN) / STEP); }

    static float at(int index) { return LongForm.clampSpeed(MIN + Math.max(0, Math.min(MAX_INDEX, index)) * STEP); }

    /** − / +: 0.1 down or up, held to the range. */
    static float nudge(float speed, int direction) { return LongForm.clampSpeed(LongForm.clampSpeed(speed) + direction * NUDGE); }

    /** Whether moving from {@code from} to {@code to} lands on or passes a quarter (a haptic tick). */
    static boolean crossesQuarter(float from, float to) {
        int a = Math.round(LongForm.clampSpeed(from) * 100), b = Math.round(LongForm.clampSpeed(to) * 100);
        if (a == b) return false;
        int lo = Math.min(a, b), hi = Math.max(a, b);
        // Quarters strictly after where it was, up to and including where it is.
        for (int q = 0; q <= 300; q += 25) {
            if (a < b ? (q > lo && q <= hi) : (q >= lo && q < hi)) return true;
        }
        return false;
    }

    /** Which preset is the current speed, or -1. */
    static int preset(float speed) {
        float s = LongForm.clampSpeed(speed);
        for (int i = 0; i < PRESETS.length; i++) if (Math.abs(PRESETS[i] - s) < 0.001f) return i;
        return -1;
    }

    /** The preset's words: "1×" with "Normal" under it, the others their number. */
    static String presetLabel(int i) { return LongForm.speedLabel(PRESETS[i]); }

    static String presetNote(int i) { return PRESETS[i] == 1f ? "Normal" : ""; }

    /** The footnote: long items keep their speed for that book or series. */
    static String footnote(boolean longItem) { return longItem ? "For this book · remembered" : ""; }
}
