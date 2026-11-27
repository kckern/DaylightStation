package net.kckern.daylight.cap.mediaservice.shell;

/**
 * A page's name never breaks inside a word (2026-11-27, a 1080-wide phone: "William Sha /
 * kespeare"). Up to two lines at the title size; if a word or the whole name does not fit,
 * one size down; if it still does not, the smaller size with the end cut off ("…"). Lines
 * wrap at spaces, as a TextView does. Pure: the width of a piece of text at a size is asked
 * of {@link Measure}.
 */
final class NameFit {
    interface Measure { float width(String text, float sizePx); }

    /** The size to draw at, and whether it still needs the ellipsis. */
    static final class Fit {
        final float sizePx;
        final boolean ellipsize;
        Fit(float sizePx, boolean ellipsize) { this.sizePx = sizePx; this.ellipsize = ellipsize; }
    }

    static final int MAX_LINES = 2;
    /** One step down from the title size. */
    static final float STEP = 0.85f;

    private NameFit() { }

    static Fit of(String name, float widthPx, float titleSizePx, Measure m) {
        if (fits(name, widthPx, titleSizePx, m)) return new Fit(titleSizePx, false);
        float smaller = titleSizePx * STEP;
        return new Fit(smaller, !fits(name, widthPx, smaller, m));
    }

    /** Every word fits on a line and the words, wrapped at spaces, take at most two lines. */
    static boolean fits(String name, float widthPx, float sizePx, Measure m) {
        if (widthPx <= 0) return true;
        String[] words = (name == null ? "" : name.trim()).split("\\s+");
        int lines = 1;
        String line = "";
        for (String w : words) {
            if (w.isEmpty()) continue;
            if (m.width(w, sizePx) > widthPx) return false;
            String tried = line.isEmpty() ? w : line + " " + w;
            if (m.width(tried, sizePx) <= widthPx) { line = tried; continue; }
            lines++;
            line = w;
            if (lines > MAX_LINES) return false;
        }
        return true;
    }
}
