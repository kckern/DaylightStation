package net.kckern.daylight.cap.mediaservice.shell;

import java.util.Locale;

/**
 * Now playing's name lines. Music reads as a record sleeve: artist, title, album (year).
 * A book, a talk or a course reads as a book: the current chapter's or part's name, then
 * the book's title, then the author. The same text is never shown twice: a line equal to
 * one above it is dropped ("Paradise - Benedict Flynn translation" as both the part and the
 * book shows once, as the title). Pure.
 */
final class TitleLines {
    /** The big line. */
    final String title;
    /** The book's title (long form) or "album (year)" (music); "" for none. */
    final String album;
    /** The author or artist; "" for none. */
    final String by;

    private TitleLines(String title, String album, String by) {
        this.title = title;
        this.album = album;
        this.by = by;
    }

    /**
     * @param longForm  a book, talk or course
     * @param chapter   the current chapter's title ("" when the item has no chapters)
     * @param itemTitle the playing item's (part's, track's) title
     * @param album     the album or book title
     * @param by        the artist or author
     * @param year      the release year, or 0; music only
     */
    static TitleLines of(boolean longForm, String chapter, String itemTitle, String album, String by, int year) {
        String c = clean(chapter), item = clean(itemTitle), a = clean(album), b = clean(by);
        String title = longForm && !c.isEmpty() ? c : item;
        if (title.isEmpty()) { title = a; a = ""; }
        if (same(a, title)) a = "";
        if (same(b, title) || same(b, a)) b = "";
        if (!longForm && year > 0) a = a.isEmpty() ? String.valueOf(year) : a + " (" + year + ")";
        return new TitleLines(title, a, b);
    }

    private static String clean(String s) { return s == null ? "" : s.trim(); }

    static boolean same(String x, String y) {
        return !x.isEmpty() && x.toLowerCase(Locale.ROOT).equals(y.toLowerCase(Locale.ROOT));
    }
}
