package net.kckern.daylight.cap.mediaservice.shell;

/**
 * The chapter overview rail under a book's chapter-scoped seek bar: one small rounded
 * segment per chapter, all the same width (never proportional to length), finished ones
 * filled, the current one highlighted, the rest hollow. When the chapters are too many for
 * segments of the minimum width at the phone's width, they are grouped in tens (ten
 * chapters a segment, then twenty, …). Pure: sizes are pixels.
 */
final class ChapterRail {
    private ChapterRail() { }

    static final class Layout {
        /** Segments drawn. */
        final int segments;
        /** Chapters per segment: 1, else a multiple of ten. */
        final int perSegment;
        /** The segment the current chapter is in (-1 for none). */
        final int current;
        /** One segment's width and the gap between two, in px. */
        final float segmentPx, gapPx;
        final int chapters;

        Layout(int segments, int perSegment, int current, float segmentPx, float gapPx, int chapters) {
            this.segments = segments;
            this.perSegment = perSegment;
            this.current = current;
            this.segmentPx = segmentPx;
            this.gapPx = gapPx;
            this.chapters = chapters;
        }

        /** Segment {@code i} is finished: every chapter in it comes before the current one. */
        boolean done(int i) { return current >= 0 && i < current; }

        /** The first chapter of segment {@code i}: where a tap on it goes. */
        int chapterOf(int i) { return Math.max(0, Math.min(chapters - 1, i * perSegment)); }

        /** The left edge of segment {@code i}, from the rail's left. */
        float left(int i) { return i * (segmentPx + gapPx); }

        /** The segment under {@code x} (from the rail's left), the nearest one for a tap in a gap; -1 off the rail. */
        int segmentAt(float x) {
            if (segments <= 0 || x < -gapPx || x > left(segments - 1) + segmentPx + gapPx) return -1;
            int i = (int) Math.floor((x + gapPx / 2f) / (segmentPx + gapPx));
            return Math.max(0, Math.min(segments - 1, i));
        }
    }

    /**
     * @param count    chapters
     * @param current  the current chapter's index (-1 for none)
     * @param widthPx  the rail's width
     * @param minSegPx the narrowest a segment may be
     * @param gapPx    the gap between two segments
     */
    static Layout layout(int count, int current, float widthPx, float minSegPx, float gapPx) {
        if (count <= 0 || widthPx <= 0) return new Layout(0, 1, -1, 0, gapPx, Math.max(0, count));
        int per = 1;
        while (segments(count, per) > 1 && segments(count, per) * (minSegPx + gapPx) - gapPx > widthPx) {
            per = per == 1 ? 10 : per + 10;
        }
        int n = segments(count, per);
        float seg = (widthPx - gapPx * (n - 1)) / n;
        int at = current < 0 ? -1 : Math.min(n - 1, current / per);
        return new Layout(n, per, at, seg, gapPx, count);
    }

    private static int segments(int count, int per) { return (count + per - 1) / per; }

    /** What TalkBack says: "Chapter 24 of 33". */
    static String said(int current, int count) {
        return current < 0 || count <= 0 ? "" : "Chapter " + (current + 1) + " of " + count;
    }
}
