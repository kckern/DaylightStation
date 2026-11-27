package net.kckern.daylight.cap.mediaservice.shell;

/**
 * What Now playing shows under its stage. With the queue open the queue takes the whole
 * stage (Plexamp, Spotify): the deck (seek bar, names, quality, transport, icon row) gives
 * way to one strip of progress, the item, play/pause, next and the lit queue button; the
 * full player comes back when the queue closes. Before this (shell 190) the queue had the
 * cover's slot only: on a real 1080x2340 phone, about a row and a half. Pure.
 */
final class QueueChrome {
    final boolean deck, strip;

    private QueueChrome(boolean deck, boolean strip) { this.deck = deck; this.strip = strip; }

    static QueueChrome of(boolean queueOpen) { return queueOpen ? new QueueChrome(false, true) : new QueueChrome(true, false); }

    /** The strip's two lines: what plays, then who by (a book: the book). */
    static final class Line {
        final CharSequence title, by;
        Line(CharSequence title, CharSequence by) { this.title = title; this.by = by; }
    }

    static Line line(CharSequence title, CharSequence by) {
        String t = title == null ? "" : title.toString().trim();
        String b = by == null ? "" : by.toString().trim();
        if (b.equalsIgnoreCase(t)) b = "";
        return new Line(t, b);
    }

    /** The strip's progress, in thousandths (0 when the length is not known). */
    static int permille(long positionMs, long durationMs) {
        if (durationMs <= 0) return 0;
        long p = Math.max(0, Math.min(positionMs, durationMs));
        return (int) (p * 1000 / durationMs);
    }
}
