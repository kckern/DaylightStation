package net.kckern.daylight.cap.mediaservice.shell;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class NameFitTest {
    /** Every character is as wide as the size: "Shakespeare" at 10 px is 110 px. */
    private static final NameFit.Measure MONO = (text, size) -> text.length() * size;

    @Test public void aNameThatFitsInTwoLinesKeepsTheTitleSize() {
        NameFit.Fit f = NameFit.of("William Shakespeare", 120, 10, MONO);
        assertEquals(10f, f.sizePx, 0.001);
        assertFalse(f.ellipsize);
    }

    @Test public void aWordWiderThanTheLineStepsDownRatherThanBreaking() {
        // "Shakespeare" is 110 px at 10 px, wider than 100: at 8.5 px it is 93.5 px.
        NameFit.Fit f = NameFit.of("William Shakespeare", 100, 10, MONO);
        assertEquals(8.5f, f.sizePx, 0.001);
        assertFalse(f.ellipsize);
    }

    @Test public void stillTooLongOneSizeDownIsCutWithAnEllipsis() {
        NameFit.Fit f = NameFit.of("The Complete Unabridged Recordings Of Everything", 100, 10, MONO);
        assertEquals(8.5f, f.sizePx, 0.001);
        assertTrue(f.ellipsize);
        assertTrue(NameFit.of("Supercalifragilistic", 100, 10, MONO).ellipsize);
    }

    @Test public void wrapsAtSpacesIntoAtMostTwoLines() {
        assertTrue(NameFit.fits("aa bb cc", 50, 10, MONO));      // "aa bb" / "cc"
        assertFalse(NameFit.fits("aa bb cc dd ee", 30, 10, MONO)); // three lines
        assertTrue(NameFit.fits("anything", 0, 10, MONO));       // not laid out yet
    }
}
