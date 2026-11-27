package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ChapterRailTest {
    // A phone's rail: 280 dp at 2.625x, with the view's minimum segment and gap (the view's units: px).
    private static final float D = 2.625f, WIDTH = 280 * D, MIN = ChapterRail.MIN_SEGMENT_DP * D, GAP = ChapterRail.GAP_DP * D;

    /** Segments at least 8 dp wide: wider than the 6 dp height, so a 2 dp radius never makes a pill. */
    @Test public void segmentsAreWiderThanTheyAreTall() {
        assertEquals(8f, ChapterRail.MIN_SEGMENT_DP, 0f);
        assertEquals(3f, ChapterRail.GAP_DP, 0f);
    }

    private static boolean fits(int segments) { return segments * (MIN + GAP) - GAP <= WIDTH; }

    @Test public void oneEqualSegmentPerChapterWhenTheyFit() {
        ChapterRail.Layout l = ChapterRail.layout(20, 13, WIDTH, MIN, GAP);
        assertEquals(20, l.segments);
        assertEquals(1, l.perSegment);
        assertEquals(13, l.current);
        assertEquals((WIDTH - GAP * 19) / 20f, l.segmentPx, 0.001f);
    }

    /** Paradise's 33 cantos at 280 dp: 25 segments fit, so two a segment, 17 segments. */
    @Test public void paradiseGroupsInTwos() {
        ChapterRail.Layout l = ChapterRail.layout(33, 23, WIDTH, MIN, GAP);
        assertEquals(2, l.perSegment);
        assertEquals(17, l.segments);
        assertEquals(11, l.current);
        assertTrue(l.segmentPx >= MIN);
    }

    /** The smallest group that fits: 45 chapters at 280 dp go in twos (23 segments), never tens (5). */
    @Test public void fortyFiveChaptersGroupInTheSmallestSizeThatFits() {
        ChapterRail.Layout l = ChapterRail.layout(45, 0, WIDTH, MIN, GAP);
        assertEquals(2, l.perSegment);
        assertEquals(23, l.segments);
        assertTrue(fits(l.segments));
        assertFalse(fits(45));
    }

    @Test public void sixtyChaptersGroupInThrees() {
        ChapterRail.Layout l = ChapterRail.layout(60, 15, WIDTH, MIN, GAP);
        assertEquals(3, l.perSegment);
        assertEquals(20, l.segments);
        assertFalse(fits(30));
    }

    /** For any count, perSegment fits and perSegment - 1 does not. */
    @Test public void theGroupIsAlwaysTheSmallestThatFits() {
        for (int count = 1; count <= 3000; count++) {
            ChapterRail.Layout l = ChapterRail.layout(count, 0, WIDTH, MIN, GAP);
            int per = l.perSegment;
            assertEquals((count + per - 1) / per, l.segments);
            assertTrue("count " + count, l.segments == 1 || fits(l.segments));
            assertTrue("count " + count, l.segmentPx >= MIN - 0.001f);
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
        ChapterRail.Layout l = ChapterRail.layout(20, 0, WIDTH, MIN, GAP);
        float mid = l.left(17) + l.segmentPx / 2;
        assertEquals(17, l.segmentAt(mid));
        assertEquals(17, l.tapTo(l.segmentAt(mid)));
        assertEquals(0, l.segmentAt(0));
        assertEquals(-1, l.segmentAt(WIDTH * 3));
        assertEquals(-1, l.tapTo(-1));
    }

    /** A tap on the segment that holds the current chapter does nothing; never back to the group's first chapter. */
    @Test public void aTapOnTheCurrentSegmentDoesNothing() {
        ChapterRail.Layout single = ChapterRail.layout(20, 12, WIDTH, MIN, GAP);
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
