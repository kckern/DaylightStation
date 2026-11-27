package net.kckern.daylight.cap.mediaservice.shell;

/**
 * The chapter overview rail under a book's chapter-scoped seek bar: one small rounded
 * segment per chapter, all the same width (never proportional to length), finished ones
 * filled, the current one highlighted, the rest hollow. When the chapters are too many for
 * segments of the minimum width at the phone's width, they are grouped by the smallest
 * number that fits (two chapters a segment, then three, …). Pure: sizes are pixels.
 */
final class ChapterRail {
    private ChapterRail() { }

    static final class Layout {
        /** Segments drawn. */
        final int segments;
        /** Chapters per segment: the smallest that fits. */
        final int perSegment;
        /** The segment the current chapter is in (-1 for none): where the highlight rests. */
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

        /** The first chapter of segment {@code i}. */
        int chapterOf(int i) { return Math.max(0, Math.min(chapters - 1, i * perSegment)); }

        /**
         * Where a tap on segment {@code seg} goes: that segment's first chapter, or -1 (nothing)
         * off the rail or on the segment that holds the current chapter (a grouped rail never
         * jumps back to the group's first chapter).
         */
        int tapTo(int seg) { return seg < 0 || seg >= segments || seg == current ? -1 : chapterOf(seg); }

        /**
         * The segment the highlight is drawn on, in segment units: {@code shown} while it slides
         * between two segments, else (shown &lt; 0) exactly the current segment.
         */
        float drawnAt(float shown) { return shown < 0 ? current : Math.max(0, Math.min(segments - 1, shown)); }

        /** The highlight's left edge for {@link #drawnAt}. */
        float highlightLeft(float shown) { return drawnAt(shown) * (segmentPx + gapPx); }

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
        // The most segments that fit, then the smallest group that brings the count under it.
        int fit = Math.max(1, (int) Math.floor((widthPx + gapPx) / (minSegPx + gapPx)));
        int per = Math.max(1, (count + fit - 1) / fit);
        int n = segments(count, per);
        float seg = (widthPx - gapPx * (n - 1)) / n;
        int at = current < 0 ? -1 : Math.min(n - 1, current / per);
        return new Layout(n, per, at, seg, gapPx, count);
    }

    private static int segments(int count, int per) { return (count + per - 1) / per; }

    /** The chapter {@code by} (±1) from {@code current}, or -1 past either end: TalkBack's Previous / Next chapter. */
    static int step(int current, int count, int by) {
        int to = current + by;
        return current < 0 || to < 0 || to >= count ? -1 : to;
    }

    /** What TalkBack says: "Chapter 24 of 33". */
    static String said(int current, int count) {
        return current < 0 || count <= 0 ? "" : "Chapter " + (current + 1) + " of " + count;
    }
}
