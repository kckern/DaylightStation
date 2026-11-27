package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.*;

import org.junit.Test;

public class BarScopeTest {
    private static final long M = 60_000;
    /** Phone width of the bar: about 300 dp at density 2.75. */
    private static final float WIDTH = 825f, DENSITY = 2.75f;

    private static float[] evenMarks(int chapters) {
        float[] m = new float[chapters - 1];
        for (int i = 1; i < chapters; i++) m[i - 1] = i / (float) chapters;
        return m;
    }

    @Test public void thirtyThreeCantosInWholeBookModeShowNoNotches() {
        assertEquals(0, BarScope.notches(evenMarks(33), WIDTH, DENSITY, BarScope.Mode.BOOK).length);
    }

    @Test public void sixChaptersShowTheirNotches() {
        assertEquals(5, BarScope.notches(evenMarks(6), WIDTH, DENSITY, BarScope.Mode.BOOK).length);
    }

    @Test public void chapterModeDrawsNoChapterNotches() {
        assertEquals(0, BarScope.notches(evenMarks(6), WIDTH, DENSITY, BarScope.Mode.CHAPTER).length);
    }

    @Test public void chapterModeOnATenMinuteCantoHasNoTimeTicks() {
        long[] starts = new long[33], ends = new long[33];
        for (int i = 0; i < 33; i++) { starts[i] = i * 10 * M; ends[i] = (i + 1) * 10 * M; }
        BarScope.Span s = BarScope.span(330 * M, starts, ends, 64 * M, BarScope.Mode.CHAPTER);
        assertEquals(6, s.chapter);
        assertEquals(60 * M, s.startMs);
        assertEquals(70 * M, s.endMs);
        assertTrue(TimeScale.restTicks(s.lengthMs()).isEmpty());
        // Whole book: 5.5 h, ticks each 30 min.
        BarScope.Span whole = BarScope.span(330 * M, starts, ends, 64 * M, BarScope.Mode.BOOK);
        assertEquals(330 * M, whole.lengthMs());
        assertEquals(10, TimeScale.restTicks(whole.lengthMs()).size());
    }

    @Test public void noChaptersMeansTheWholeFileInEitherMode() {
        BarScope.Span s = BarScope.span(100 * M, new long[0], new long[0], 5 * M, BarScope.Mode.CHAPTER);
        assertEquals(0, s.startMs);
        assertEquals(100 * M, s.endMs);
        assertEquals(-1, s.chapter);
        assertFalse(s.chapterMode);
    }

    @Test public void theLineUsesTheChaptersOwnWord() {
        String[] cantos = new String[33];
        for (int i = 0; i < 33; i++) cantos[i] = "Canto " + (i + 1);
        assertEquals("Canto", BarScope.word(cantos));
        assertEquals("Book", BarScope.word(new String[] { "Book I", "Book II", "Book III" }));
        assertEquals("Chapter", BarScope.word(new String[] { "The Return", "Home", "Book I" }));
        assertEquals("Chapter", BarScope.word(null));
        long[] starts = new long[33], ends = new long[33];
        for (int i = 0; i < 33; i++) { starts[i] = i * 10 * M; ends[i] = (i + 1) * 10 * M; }
        BarScope.Span s = BarScope.span(330 * M, starts, ends, 64 * M, BarScope.Mode.CHAPTER);
        assertEquals("Canto 7 of 33 · 4 h 26 min left in book", BarScope.line("Canto", s, 64 * M, 330 * M, 1f));
        // At 1× whatever the speed: one rule for "left" (TimeLeft).
        assertEquals("Canto 7 of 33 · 4 h 26 min left in book", BarScope.line("Canto", s, 64 * M, 330 * M, 2f));
    }

    @Test public void theModeIsRemembered() {
        assertEquals(BarScope.Mode.CHAPTER, BarScope.mode(null));
        assertEquals(BarScope.Mode.BOOK, BarScope.mode(BarScope.saved(BarScope.Mode.BOOK)));
    }
}
