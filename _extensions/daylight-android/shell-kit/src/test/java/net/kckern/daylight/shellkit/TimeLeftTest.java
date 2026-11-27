package net.kckern.daylight.shellkit;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

public class TimeLeftTest {
    @Test public void oneFormEverywhere() {
        assertEquals("1 h 38 min left", TimeLeft.words(98 * 60 + 59));
        assertEquals("36 min left", TimeLeft.words(36 * 60));
        assertEquals("1 h 0 min left", TimeLeft.words(3600));
        assertEquals("Under a minute left", TimeLeft.words(59));
        assertEquals("Under a minute left", TimeLeft.words(-5));
        assertEquals("2 h 46 min", TimeLeft.amount(166 * 60));
    }
}
