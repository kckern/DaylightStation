package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ChapterRailTest {
    @Test public void oneEqualSegmentPerChapterWhenTheyFit() {
        ChapterRail.Layout l = ChapterRail.layout(33, 23, 900, 4, 3); // 33 chapters, at index 23, 900 px, min 4 px, 3 px gap
        assertEquals(33, l.segments);
        assertEquals(1, l.perSegment);
        assertEquals(23, l.current);
        assertEquals((900 - 3 * 32) / 33f, l.segmentPx, 0.001f);
    }

    @Test public void tooManyChaptersAreGroupedInTens() {
        ChapterRail.Layout l = ChapterRail.layout(400, 155, 600, 4, 3);
        assertTrue(l.segments < 400);
        assertEquals(10, l.perSegment);
        assertEquals(40, l.segments);
        assertEquals(155 / l.perSegment, l.current);
    }

    @Test public void stillTooManyGoesToTwentyAndOn() {
        ChapterRail.Layout l = ChapterRail.layout(2000, 0, 600, 4, 3);
        assertEquals(30, l.perSegment);
        assertTrue(l.segments * 7 - 3 <= 600);
    }

    @Test public void doneSegmentsAreThoseBeforeTheCurrent() {
        ChapterRail.Layout l = ChapterRail.layout(10, 4, 900, 4, 3);
        assertTrue(l.done(3));
        assertFalse(l.done(4));
        assertFalse(l.done(5));
    }

    @Test public void aTapFindsItsSegmentAndItsFirstChapter() {
        ChapterRail.Layout l = ChapterRail.layout(33, 0, 900, 4, 3);
        float mid = l.left(29) + l.segmentPx / 2;
        assertEquals(29, l.segmentAt(mid));
        assertEquals(29, l.chapterOf(l.segmentAt(mid)));
        assertEquals(0, l.segmentAt(0));
        assertEquals(-1, l.segmentAt(2000));
        ChapterRail.Layout grouped = ChapterRail.layout(400, 0, 600, 4, 3);
        assertEquals(150, grouped.chapterOf(15));
    }

    @Test public void noChaptersNoRail() {
        assertEquals(0, ChapterRail.layout(0, -1, 900, 4, 3).segments);
        assertFalse(ChapterRail.layout(0, -1, 900, 4, 3).done(0));
    }

    @Test public void talkBackSaysWhichChapter() {
        assertEquals("Chapter 24 of 33", ChapterRail.said(23, 33));
    }
}
