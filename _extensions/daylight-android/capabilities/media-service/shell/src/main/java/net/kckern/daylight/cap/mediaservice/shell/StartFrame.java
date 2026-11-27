package net.kckern.daylight.cap.mediaservice.shell;

/**
 * Now playing's Starting frame, laid out as the playing frame of the same kind will be, so
 * nothing moves when the item lands (2026-11-27: a book's Starting frame showed the author
 * above the title and music's shuffle, repeat and lyrics; the playing frame then had the
 * part, the book, the author and only queue, speed, ⋮ and cast). The kind comes with the
 * Starting extras (Starting.EXTRA_LONG) from every play path. Pure.
 */
final class StartFrame {
    final String title, by;
    /** The by-line sits under the book's line (a book), not above the title (music). */
    final boolean byBelow;
    /** ±10 s in the transport row. */
    final boolean jumps;
    /** The audio-quality line keeps its place (music only; a book has none). */
    final boolean quality;
    final MediaKind.Controls controls;

    private StartFrame(String title, String by, boolean longForm) {
        this.title = title;
        this.by = by;
        this.byBelow = longForm;
        this.jumps = longForm;
        this.quality = !longForm;
        this.controls = MediaKind.controls(longForm);
    }

    static StartFrame of(boolean longForm, String title, String subtitle) {
        String t = title == null ? "" : title.trim();
        String b = subtitle == null ? "" : subtitle.trim();
        if (b.equalsIgnoreCase(t)) b = "";
        return new StartFrame(t.isEmpty() ? "Starting…" : t, b, longForm);
    }
}
