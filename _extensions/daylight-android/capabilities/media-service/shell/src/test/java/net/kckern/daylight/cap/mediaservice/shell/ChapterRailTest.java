package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ChapterRailTest {
    // A phone's rail: 280 dp at 2.625x, 4 dp segments at the least, 3 dp gaps (the view's units: px).
    private static final float D = 2.625f, WIDTH = 280 * D, MIN = 4 * D, GAP = 3 * D;

    private static boolean fits(int segments) { return segments * (MIN + GAP) - GAP <= WIDTH; }

    @Test public void oneEqualSegmentPerChapterWhenTheyFit() {
        ChapterRail.Layout l = ChapterRail.layout(33, 23, WIDTH, MIN, GAP);
        assertEquals(33, l.segments);
        assertEquals(1, l.perSegment);
        assertEquals(23, l.current);
        assertEquals((WIDTH - GAP * 32) / 33f, l.segmentPx, 0.001f);
    }

    /** The smallest group that fits: 45 chapters at 280 dp go in twos (23 segments), never tens (5). */
    @Test public void fortyFiveChaptersGroupInTheSmallestSizeThatFits() {
        ChapterRail.Layout l = ChapterRail.layout(45, 0, WIDTH, MIN, GAP);
        assertEquals(2, l.perSegment);
        assertEquals(23, l.segments);
        assertTrue(fits(l.segments));
        assertFalse(fits(45));
    }

    @Test public void sixtyChaptersGroupInTwos() {
        ChapterRail.Layout l = ChapterRail.layout(60, 15, WIDTH, MIN, GAP);
        assertEquals(2, l.perSegment);
        assertEquals(30, l.segments);
    }

    /** For any count, perSegment fits and perSegment - 1 does not. */
    @Test public void theGroupIsAlwaysTheSmallestThatFits() {
        for (int count = 1; count <= 3000; count++) {
            ChapterRail.Layout l = ChapterRail.layout(count, 0, WIDTH, MIN, GAP);
            int per = l.perSegment;
            assertEquals((count + per - 1) / per, l.segments);
            assertTrue("count " + count, l.segments == 1 || fits(l.segments));
            if (per > 1) assertFalse("count " + count, fits((count + per - 2) / (per - 1)));
        }
    }

    /** The highlight is drawn on one whole segment: 60 chapters at chapter 15 → segment 15 / perSegment, exactly. */
    @Test public void theHighlightSitsOnOneSegmentOfAGroupedRail() {
        ChapterRail.Layout l = ChapterRail.layout(60, 15, WIDTH, MIN, GAP);
        assertTrue(l.perSegment > 1);
        float drawn = l.drawnAt(-1f);
        assertEquals(15 / l.perSegment, drawn, 0f);
        assertEquals(drawn, Math.round(drawn), 0f);
        assertEquals(l.left(15 / l.perSegment), l.highlightLeft(-1f), 0f);
        // Mid-slide it is in segment units, between the two segments.
        assertEquals(l.left(3) + (l.segmentPx + l.gapPx) / 2f, l.highlightLeft(3.5f), 0.001f);
    }

    @Test public void doneSegmentsAreThoseBeforeTheCurrent() {
        ChapterRail.Layout l = ChapterRail.layout(10, 4, WIDTH, MIN, GAP);
        assertTrue(l.done(3));
        assertFalse(l.done(4));
        assertFalse(l.done(5));
    }

    @Test public void aTapFindsItsSegmentAndItsFirstChapter() {
        ChapterRail.Layout l = ChapterRail.layout(33, 0, WIDTH, MIN, GAP);
        float mid = l.left(29) + l.segmentPx / 2;
        assertEquals(29, l.segmentAt(mid));
        assertEquals(29, l.tapTo(l.segmentAt(mid)));
        assertEquals(0, l.segmentAt(0));
        assertEquals(-1, l.segmentAt(WIDTH * 3));
        assertEquals(-1, l.tapTo(-1));
    }

    /** A tap on the segment that holds the current chapter does nothing; never back to the group's first chapter. */
    @Test public void aTapOnTheCurrentSegmentDoesNothing() {
        ChapterRail.Layout single = ChapterRail.layout(33, 12, WIDTH, MIN, GAP);
        assertEquals(-1, single.tapTo(12));
        ChapterRail.Layout grouped = ChapterRail.layout(60, 15, WIDTH, MIN, GAP);
        assertEquals(-1, grouped.tapTo(15 / grouped.perSegment));
        // Any other segment: that group's first chapter.
        assertEquals(10 * grouped.perSegment, grouped.tapTo(10));
        assertEquals(0, grouped.tapTo(0));
    }

    @Test public void noChaptersNoRail() {
        assertEquals(0, ChapterRail.layout(0, -1, WIDTH, MIN, GAP).segments);
        assertFalse(ChapterRail.layout(0, -1, WIDTH, MIN, GAP).done(0));
    }

    @Test public void talkBackSaysWhichChapterAndStepsOne() {
        assertEquals("Chapter 24 of 33", ChapterRail.said(23, 33));
        assertEquals(22, ChapterRail.step(23, 33, -1));
        assertEquals(24, ChapterRail.step(23, 33, 1));
        assertEquals(-1, ChapterRail.step(0, 33, -1));
        assertEquals(-1, ChapterRail.step(32, 33, 1));
        assertEquals(-1, ChapterRail.step(-1, 33, 1));
    }
}
