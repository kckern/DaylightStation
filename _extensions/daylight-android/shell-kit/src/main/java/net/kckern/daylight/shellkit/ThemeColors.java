package net.kckern.daylight.shellkit;

/**
 * Every color a screen uses, computed from seven seeds. A palette (the shell-kit defaults,
 * a device file's override, or a cover's color on Now playing) sets only the seeds; the
 * rest follows, so text on a colored fill is always readable and a changed primary never
 * leaves a mismatched ripple or tint behind.
 *
 * <p>Pure integer ARGB arithmetic: android.graphics.Color returns stubs in JVM tests.
 */
public final class ThemeColors {
    public final boolean dark;
    // Seeds.
    public final int background, surface, ink, primary, secondary, danger, attention;
    // Derived.
    public final int surfaceVariant, tile, inkMuted, outline, onPrimary, onSecondary,
            attentionContainer, disabled, ripple, scrim, track, trackBuffered;

    private static final int DARK_TEXT = 0xff10201a, WHITE = 0xffffffff;

    public ThemeColors(boolean dark, int background, int surface, int ink, int primary,
                       int secondary, int danger, int attention) {
        this.dark = dark;
        this.background = opaque(background);
        this.surface = opaque(surface);
        this.ink = opaque(ink);
        this.primary = opaque(primary);
        this.secondary = opaque(secondary);
        this.danger = opaque(danger);
        this.attention = opaque(attention);
        surfaceVariant = mix(this.surface, this.ink, dark ? 0.10 : 0.08);
        tile = mix(this.background, this.primary, dark ? 0.16 : 0.12);
        inkMuted = mix(this.background, this.ink, dark ? 0.68 : 0.72);
        outline = mix(this.background, this.ink, dark ? 0.14 : 0.10);
        onPrimary = readableOn(this.primary);
        onSecondary = readableOn(this.secondary);
        attentionContainer = mix(this.surface, this.attention, dark ? 0.22 : 0.14);
        disabled = mix(this.background, this.ink, dark ? 0.32 : 0.34);
        ripple = alpha(this.primary, dark ? 0x40 : 0x30);
        scrim = dark ? 0x66000000 : 0x33000000;
        track = alpha(this.ink, dark ? 0x33 : 0x26);
        trackBuffered = alpha(this.ink, dark ? 0x66 : 0x59);
    }

    /**
     * This palette with a cover's color: the primary becomes the cover color moved until it
     * stands out on the background, and the background takes a little of it. Seeds that
     * mean something (danger, attention) stay.
     */
    public ThemeColors withAccent(int cover) {
        // Tint the page first, then hold the accent to the page it will actually sit on.
        int bg = mix(background, opaque(cover), dark ? 0.18 : 0.10);
        int surf = mix(surface, opaque(cover), dark ? 0.12 : 0.06);
        int accent = legibleOn(opaque(cover), bg, dark);
        return new ThemeColors(dark, bg, surf, ink, accent, secondary, danger, attention);
    }

    // --- color arithmetic -------------------------------------------------------------

    /** {@code a} moved toward {@code b} by {@code t} (0..1), per channel; opaque. */
    public static int mix(int a, int b, double t) {
        int r = (int) Math.round(red(a) + (red(b) - red(a)) * t);
        int g = (int) Math.round(green(a) + (green(b) - green(a)) * t);
        int bl = (int) Math.round(blue(a) + (blue(b) - blue(a)) * t);
        return 0xff000000 | (r << 16) | (g << 8) | bl;
    }

    public static int alpha(int color, int alpha) { return (color & 0x00ffffff) | ((alpha & 0xff) << 24); }

    /** White or near-black, whichever contrasts more with {@code fill}. */
    public static int readableOn(int fill) {
        return contrast(fill, WHITE) >= contrast(fill, DARK_TEXT) ? WHITE : DARK_TEXT;
    }

    /** WCAG relative luminance. */
    public static double luminance(int color) {
        return 0.2126 * linear(red(color)) + 0.7152 * linear(green(color)) + 0.0722 * linear(blue(color));
    }

    public static double contrast(int a, int b) {
        double la = luminance(a), lb = luminance(b);
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    }

    /** {@code color}, lightened (on dark) or darkened (on light) until it reaches 3:1 against {@code background}. */
    static int legibleOn(int color, int background, boolean dark) {
        int target = dark ? WHITE : 0xff000000;
        int c = color;
        for (int i = 1; i <= 20 && contrast(c, background) < 3.0; i++) c = mix(color, target, i * 0.05);
        return c;
    }

    private static int opaque(int c) { return c | 0xff000000; }
    private static int red(int c) { return (c >> 16) & 0xff; }
    private static int green(int c) { return (c >> 8) & 0xff; }
    private static int blue(int c) { return c & 0xff; }

    private static double linear(int channel) {
        double s = channel / 255.0;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    }
}
