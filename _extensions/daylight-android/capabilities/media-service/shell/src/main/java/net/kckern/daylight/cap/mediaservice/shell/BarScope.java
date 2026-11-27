package net.kckern.daylight.cap.mediaservice.shell;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * What the seek bar spans and which chapter notches it draws
 * (ops:docs/superpowers/specs/2026-11-26-phone-lookup-and-browse.md §12d, after the owner saw
 * 33 canto notches on Paradise: "ticks too ugly!").
 *
 * <ul>
 *   <li><b>Chapter</b> (the default for an item with chapters): the bar spans the current
 *       chapter; the times either side are the chapter's elapsed and remaining; a line under
 *       it reads "Canto 7 of 33 · 2 h 46 left in book"; no chapter notches (it is one).</li>
 *   <li><b>Whole book</b> (⋮ Progress bar, remembered): the bar spans the file; chapter notches
 *       only when every two are at least 24 dp apart, otherwise none, with a lighter band
 *       over the current chapter's span.</li>
 * </ul>
 * Time ticks (§12c) are chosen for the span shown, so a 10 min canto has none. Pure.
 */
final class BarScope {
    enum Mode { CHAPTER, BOOK }

    static final float MIN_NOTCH_GAP_DP = 24;
    static final String PREF = "progressBar";

    /** The span shown, in the file's ms, and which chapter it is (-1 for none). */
    static final class Span {
        final long startMs, endMs;
        final int chapter, count;
        final boolean chapterMode;
        Span(long startMs, long endMs, int chapter, int count, boolean chapterMode) {
            this.startMs = startMs; this.endMs = endMs; this.chapter = chapter; this.count = count; this.chapterMode = chapterMode;
        }
        long lengthMs() { return Math.max(0, endMs - startMs); }
        float startFraction(long fileMs) { return fileMs > 0 ? startMs / (float) fileMs : 0f; }
        float endFraction(long fileMs) { return fileMs > 0 ? Math.min(1f, endMs / (float) fileMs) : 1f; }
    }

    private BarScope() { }

    static Mode mode(String saved) { return "book".equals(saved) ? Mode.BOOK : Mode.CHAPTER; }

    static String saved(Mode m) { return m == Mode.BOOK ? "book" : "chapter"; }

    /** The chapter the position is in: the last start it has reached (0 before the first). */
    static int chapterAt(long[] starts, long positionMs) {
        int at = 0;
        for (int i = 0; i < starts.length; i++) if (positionMs >= starts[i]) at = i;
        return at;
    }

    /** What the bar spans: the current chapter in chapter mode (with two or more chapters), else the whole file. */
    static Span span(long fileMs, long[] starts, long[] ends, long positionMs, Mode mode) {
        boolean chaptered = starts != null && ends != null && starts.length >= 2 && starts.length == ends.length;
        if (!chaptered) return new Span(0, Math.max(0, fileMs), -1, 0, false);
        int i = chapterAt(starts, positionMs);
        if (mode == Mode.BOOK) return new Span(0, Math.max(0, fileMs), i, starts.length, false);
        long end = ends[i];
        if (fileMs > 0) end = Math.min(end, fileMs);
        return new Span(i == 0 ? 0 : starts[i], Math.max(end, starts[i] + 1), i, starts.length, true);
    }

    /**
     * Chapter notches to draw (fractions of the file): none in chapter mode; in whole-book
     * mode all of them when every neighbouring pair (and each against the ends) is at least
     * {@link #MIN_NOTCH_GAP_DP} apart at this width, otherwise none.
     */
    static float[] notches(float[] marks, float widthPx, float density, Mode mode) {
        if (mode == Mode.CHAPTER || marks == null || marks.length == 0 || widthPx <= 0) return new float[0];
        float min = MIN_NOTCH_GAP_DP * density;
        float last = 0f;
        for (float m : marks) {
            if ((m - last) * widthPx < min) return new float[0];
            last = m;
        }
        if ((1f - last) * widthPx < min) return new float[0];
        return marks.clone();
    }

    private static final Pattern WORDED = Pattern.compile("^\\s*([A-Za-z]+)\\s+([0-9]+|[IVXLCDM]+)\\b.*");

    /**
     * The chapters' own word when most titles share one ("Canto 7", "Book II", "Part 3"),
     * otherwise "Chapter".
     */
    static String word(String[] titles) {
        if (titles == null || titles.length == 0) return "Chapter";
        java.util.Map<String, Integer> seen = new java.util.HashMap<>();
        for (String t : titles) {
            Matcher m = WORDED.matcher(t == null ? "" : t);
            if (m.matches()) {
                String w = m.group(1);
                String key = w.substring(0, 1).toUpperCase(Locale.ROOT) + w.substring(1).toLowerCase(Locale.ROOT);
                seen.merge(key, 1, Integer::sum);
            }
        }
        String best = "Chapter";
        int n = 0;
        for (java.util.Map.Entry<String, Integer> e : seen.entrySet()) if (e.getValue() > n) { n = e.getValue(); best = e.getKey(); }
        return n * 2 >= titles.length ? best : "Chapter";
    }

    /** "Canto 7 of 33 · 2 h 46 left in book" (time left as it will be spent, at the speed). */
    static String line(String word, Span s, long positionMs, long fileMs, float speed) {
        if (s.chapter < 0) return "";
        long left = (long) (Math.max(0, fileMs - positionMs) / Math.max(0.1f, speed));
        return word + " " + (s.chapter + 1) + " of " + s.count + " · " + left(left) + " left in book";
    }

    /** "2 h 46", "46 min", "under a minute". */
    static String left(long ms) {
        long min = ms / 60_000;
        if (min < 1) return "under a minute";
        if (min < 60) return min + " min";
        return (min / 60) + " h " + String.format(Locale.ROOT, "%02d", min % 60);
    }
}
