package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.*;

import org.junit.Test;

public class SpeedStepsTest {
    @Test public void theSliderRunsFromHalfToThreeInTwentiethSteps() {
        assertEquals(50, SpeedSteps.MAX_INDEX);
        assertEquals(0.5f, SpeedSteps.at(0), 1e-4);
        assertEquals(3f, SpeedSteps.at(50), 1e-4);
        assertEquals(1.5f, SpeedSteps.at(SpeedSteps.index(1.5f)), 1e-4);
        assertEquals(1.05f, SpeedSteps.at(11), 1e-4);
        assertEquals(3f, SpeedSteps.at(99), 1e-4);
    }

    @Test public void minusAndPlusMoveATenthAndStopAtTheEnds() {
        assertEquals(1.6f, SpeedSteps.nudge(1.5f, 1), 1e-4);
        assertEquals(1.4f, SpeedSteps.nudge(1.5f, -1), 1e-4);
        assertEquals(3f, SpeedSteps.nudge(2.95f, 1), 1e-4);
        assertEquals(0.5f, SpeedSteps.nudge(0.55f, -1), 1e-4);
    }

    @Test public void aTickAtEachQuarter() {
        assertTrue(SpeedSteps.crossesQuarter(1.2f, 1.25f));
        assertTrue(SpeedSteps.crossesQuarter(1.2f, 1.3f));
        assertFalse(SpeedSteps.crossesQuarter(1.3f, 1.35f));
        assertTrue(SpeedSteps.crossesQuarter(1.3f, 1.25f));
        assertFalse(SpeedSteps.crossesQuarter(1.25f, 1.3f));   // leaving a quarter is not landing on one
        assertFalse(SpeedSteps.crossesQuarter(1.5f, 1.5f));
    }

    @Test public void presetsAreOneToTwoWithNormalUnderOne() {
        assertEquals(0, SpeedSteps.preset(1f));
        assertEquals(2, SpeedSteps.preset(1.5f));
        assertEquals(-1, SpeedSteps.preset(1.1f));
        assertEquals("1×", SpeedSteps.presetLabel(0));
        assertEquals("Normal", SpeedSteps.presetNote(0));
        assertEquals("1.75×", SpeedSteps.presetLabel(3));
        assertEquals("", SpeedSteps.presetNote(3));
        assertEquals("For this book · remembered", SpeedSteps.footnote(true));
        assertEquals("", SpeedSteps.footnote(false));
    }
}
