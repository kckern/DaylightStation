package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.*;

import net.kckern.daylight.shellkit.CoverColor;
import net.kckern.daylight.shellkit.ThemeColors;

import org.junit.Test;

public class DetailLookTest {
    private static final int DARK_BG = 0xff121a18, LIGHT_BG = 0xfff6f8f7, GOLD = 0xffd4a020, MINT = 0xff4fd1a0;

    /** The play fill is dark and quiet, never the bright accent, and its glyph reads (4.5:1). */
    @Test public void thePlayFillIsQuietAndItsGlyphReads() {
        for (int bg : new int[] { DARK_BG, LIGHT_BG }) {
            for (int cover : new int[] { GOLD, MINT, CoverColor.NONE }) {
                boolean dark = bg == DARK_BG;
                int fill = DetailLook.playFill(bg, cover, dark);
                assertTrue(ThemeColors.contrast(fill, 0xffffffff) >= 7.0);
                assertTrue(ThemeColors.contrast(fill, DetailLook.playGlyph(fill)) >= 4.5);
                assertNotEquals(MINT, fill);
            }
        }
        // It takes the cover's hue: a gold cover gives a warm fill (red over blue).
        int warm = DetailLook.playFill(DARK_BG, GOLD, true);
        assertTrue(((warm >> 16) & 0xff) > (warm & 0xff));
    }

    @Test public void theGradientStartsInTheCoversColourAndEndsInThePage() {
        assertEquals(DARK_BG, DetailLook.gradientTop(DARK_BG, CoverColor.NONE, true));
        int top = DetailLook.gradientTop(DARK_BG, GOLD, true), mid = DetailLook.gradientMiddle(DARK_BG, GOLD, true);
        assertNotEquals(DARK_BG, top);
        // Quieter by the middle stop: closer to the page.
        assertTrue(ThemeColors.contrast(mid, DARK_BG) < ThemeColors.contrast(top, DARK_BG));
        // Light pages stay light enough for ink.
        assertTrue(ThemeColors.luminance(DetailLook.gradientTop(LIGHT_BG, GOLD, false)) > 0.5);
    }

    @Test public void theCountLine() {
        assertEquals("13 tracks · 1 h 3 min", DetailLook.countLine("album", 13, 3780));
        assertEquals("5 parts · 3 h 2 min", DetailLook.countLine("book", 5, 10_920));
        assertEquals("1 part · 42 min", DetailLook.countLine("book", 1, 2520));
        assertEquals("12 lectures", DetailLook.countLine("series", 12, 0));
        assertEquals("", DetailLook.countLine("album", 0, 100));
    }

    @Test public void aCompactRowsLengthAndWords() {
        assertEquals("4:46", DetailLook.rowLength("album", 286));
        assertEquals("9 min", DetailLook.rowLength("book", 527));
        assertEquals("", DetailLook.rowLength("album", 0));
        assertEquals("Track 3, Workin' Them Angels, 4 minutes 46 seconds", DetailLook.rowSpoken("album", 3, "Workin' Them Angels", 286));
        assertEquals("Part 2, Act II, 1 hour 12 minutes", DetailLook.rowSpoken("book", 2, "Act II", 4310));
        assertEquals("Track 1, Hope, 2 minutes", DetailLook.rowSpoken("album", 1, "Hope", 120));
        assertEquals("Track 4, Intro", DetailLook.rowSpoken("playlist", 4, "Intro", 0));
    }

    /** As many whole summary lines as fit beside the portrait under the facts, with More's line kept. */
    @Test public void theSummaryFitsBesideThePortrait() {
        // 132 dp portrait at 2.625x = 347 px; facts 50 px; More 50 px; 57 px lines: 4 lines.
        assertEquals(4, DetailLook.summaryLines(347, 50, 50, 57));
        assertEquals(0, DetailLook.summaryLines(100, 60, 50, 57));
        assertEquals(0, DetailLook.summaryLines(347, 50, 50, 0));
    }

    @Test public void moreOpensTheRestBelow() {
        String s = "William Shakespeare was an English playwright. He is widely regarded as the greatest writer.";
        assertEquals("He is widely regarded as the greatest writer.", DetailLook.rest(s, 47));
        assertEquals(s, DetailLook.rest(s, 0));
        assertEquals("", DetailLook.rest(s, s.length()));
        assertEquals("", DetailLook.rest(null, 3));
    }

    @Test public void everyHeaderSlotHasItsHeightBeforeTheAnswer() {
        DetailLook.Slots s = DetailLook.slots("book", /*hasCachedAbout*/ false);
        assertEquals(1, s.bylineLines);
        assertEquals(1, s.keepLines);
        assertTrue(s.rowsReserved >= 8);    // placeholder rows until the first page
    }

    @Test public void aCachedPageHasNoPlaceholders() {
        DetailLook.Slots s = DetailLook.slots("album", true);
        assertEquals(1, s.bylineLines);
        assertEquals(1, s.keepLines);
        assertEquals(0, s.rowsReserved);
    }

    @Test public void aPersonsPageHasNoByLineOrKeepLine() {
        DetailLook.Slots s = DetailLook.slots("author", false);
        assertEquals(0, s.bylineLines);
        assertEquals(0, s.keepLines);
    }
}
