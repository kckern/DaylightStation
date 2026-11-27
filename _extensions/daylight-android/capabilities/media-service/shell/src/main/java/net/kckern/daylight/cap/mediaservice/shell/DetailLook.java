package net.kckern.daylight.cap.mediaservice.shell;

import net.kckern.daylight.shellkit.CoverColor;
import net.kckern.daylight.shellkit.ThemeColors;

/**
 * A detail page's look (2026-11-27, after Plexamp's album page): the colours it takes from
 * its cover, the summary line over the list ("13 tracks · 1 h 3 min"), the compact numbered
 * row's length and spoken words, and how many lines of a person's summary fit beside the
 * portrait. Pure: colours are ARGB ints (ThemeColors arithmetic), sizes are pixels.
 */
final class DetailLook {
    private DetailLook() { }

    private static final int BLACK = 0xff000000;

    /**
     * The primary play button's fill: the cover's colour, dark and quiet (never the bright
     * accent), so a white glyph reads on it. With no cover colour, a dark fill of the page.
     */
    static int playFill(int background, int cover, boolean dark) {
        if (cover == CoverColor.NONE) return ThemeColors.mix(background, BLACK, dark ? 0.45 : 0.78);
        int tinted = ThemeColors.mix(background, cover | BLACK, 0.45);
        int fill = ThemeColors.mix(tinted, BLACK, dark ? 0.40 : 0.55);
        // A light cover stays dark enough for a white glyph at 7:1 (quiet, never a bright disc).
        for (int i = 1; i <= 10 && ThemeColors.contrast(fill, 0xffffffff) < 7.0; i++) fill = ThemeColors.mix(fill, BLACK, 0.15);
        return fill;
    }

    /** The glyph on {@link #playFill}: white or near-black, whichever reads. */
    static int playGlyph(int fill) { return ThemeColors.readableOn(fill); }

    /** The top of the page's gradient (and the bar over it): Now playing's tint of the cover's colour. */
    static int gradientTop(int background, int cover, boolean dark) {
        if (cover == CoverColor.NONE) return background;
        return ThemeColors.mix(background, cover | BLACK, dark ? 0.30 : 0.18);
    }

    /** The gradient's middle stop: most of the tint gone by a third of the page. */
    static int gradientMiddle(int background, int cover, boolean dark) {
        if (cover == CoverColor.NONE) return background;
        return ThemeColors.mix(background, cover | BLACK, dark ? 0.10 : 0.06);
    }

    /**
     * The line over the list: "13 tracks · 1 h 3 min", a book's "5 parts · 3 h 2 min", a
     * series' lectures. "" with no rows; the count alone when no row has a length.
     */
    static String countLine(String kind, int n, long totalSec) {
        if (n <= 0) return "";
        String noun;
        switch (MediaKind.normal(kind)) {
            case "book": noun = n == 1 ? "part" : "parts"; break;
            case "series": noun = n == 1 ? "lecture" : "lectures"; break;
            default: noun = n == 1 ? "track" : "tracks";
        }
        String count = n + RowLine.NB + noun;
        return totalSec > 0 ? count + " · " + RowLine.spokenLength(totalSec) : count;
    }

    /** A compact row's length, flush right: a song's "4:46", a part's or lecture's "9 min". */
    static String rowLength(String pageKind, long seconds) {
        if (seconds <= 0) return "";
        return MediaKind.spoken(pageKind) ? RowLine.spokenLength(seconds) : RowLine.length(seconds);
    }

    /** What TalkBack reads for a compact row: "Track 3, Workin' Them Angels, 4 minutes 46 seconds". */
    static String rowSpoken(String pageKind, int number, String title, long seconds) {
        String k = MediaKind.normal(pageKind);
        String what = "book".equals(k) ? "Part" : "series".equals(k) ? "Lecture" : "Track";
        StringBuilder b = new StringBuilder(what).append(' ').append(number).append(", ").append(title);
        if (seconds > 0) b.append(", ").append(spokenDuration(seconds, MediaKind.spoken(pageKind)));
        return b.toString();
    }

    /** "4 minutes 46 seconds", "1 hour 12 minutes"; spoken word to the minute. */
    static String spokenDuration(long seconds, boolean toTheMinute) {
        long h = seconds / 3600, m = (seconds % 3600) / 60, s = seconds % 60;
        if (toTheMinute) {
            long minutes = Math.max(1, Math.round(seconds / 60.0));
            h = minutes / 60; m = minutes % 60; s = 0;
        }
        StringBuilder b = new StringBuilder();
        if (h > 0) b.append(h).append(h == 1 ? " hour" : " hours");
        if (m > 0) sep(b).append(m).append(m == 1 ? " minute" : " minutes");
        if (s > 0 || b.length() == 0) sep(b).append(s).append(s == 1 ? " second" : " seconds");
        return b.toString();
    }

    private static StringBuilder sep(StringBuilder b) { return b.length() == 0 ? b : b.append(' '); }

    /**
     * Lines of a person's summary that fit beside the portrait: the portrait's height less
     * what sits above the summary (the facts) and the More line under it, in whole lines of
     * the summary's line height. 0 when not one line fits (the summary then opens below only).
     */
    static int summaryLines(int portraitPx, int abovePx, int morePx, int lineHeightPx) {
        if (lineHeightPx <= 0) return 0;
        int room = portraitPx - Math.max(0, abovePx) - Math.max(0, morePx);
        return Math.max(0, room / lineHeightPx);
    }

    /** What More opens below the portrait: the summary after the {@code cut} characters shown beside it. */
    static String rest(String summary, int cut) {
        if (summary == null) return "";
        if (cut <= 0) return summary.trim();
        if (cut >= summary.length()) return "";
        return summary.substring(cut).trim();
    }
}
