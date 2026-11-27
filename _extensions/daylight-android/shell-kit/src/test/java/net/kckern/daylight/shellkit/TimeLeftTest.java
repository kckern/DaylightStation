package net.kckern.daylight.shellkit;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

public class TimeLeftTest {
    @Test public void oneFormEverywhere() {
        assertEquals("1 h 38 min left", TimeLeft.words(98 * 60 + 29));
        // The nearest minute: 5809 s and 5823 s (the same book from two of home's lists) agree.
        assertEquals("1 h 37 min left", TimeLeft.words(5809));
        assertEquals("1 h 37 min left", TimeLeft.words(5823));
        assertEquals("36 min left", TimeLeft.words(36 * 60));
        assertEquals("1 h 0 min left", TimeLeft.words(3600));
        assertEquals("Under a minute left", TimeLeft.words(29));
        assertEquals("1 min left", TimeLeft.words(59));
        assertEquals("Under a minute left", TimeLeft.words(-5));
        assertEquals("2 h 46 min", TimeLeft.amount(166 * 60));
    }
}
