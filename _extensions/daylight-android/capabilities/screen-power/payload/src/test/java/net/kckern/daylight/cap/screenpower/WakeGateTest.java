package net.kckern.daylight.cap.screenpower;

import static org.junit.Assert.*;

import org.junit.Test;

public class WakeGateTest {
    @Test public void aBurstOfNotesWakesOnce() {
        WakeGate g = new WakeGate();
        assertTrue(g.allow(100_000, 600, 8_000, "", ""));
        assertFalse(g.allow(100_050, 600, 8_000, "", ""));
        assertFalse(g.allow(107_999, 600, 8_000, "", ""));
        assertTrue(g.allow(108_000, 600, 8_000, "", ""));
    }

    @Test public void nothingWakesInsideTheNoWakeWindow() {
        WakeGate g = new WakeGate();
        assertFalse(g.allow(100_000, 22 * 60, 8_000, "21:30", "06:30"));      // 22:00, window wraps midnight
        assertFalse(g.allow(200_000, 3 * 60, 8_000, "21:30", "06:30"));       // 03:00
        assertTrue(g.allow(300_000, 6 * 60 + 30, 8_000, "21:30", "06:30"));   // 06:30, the end is exclusive
        assertFalse(new WakeGate().allow(1, 13 * 60, 0, "12:00", "14:00"));   // a same-day window
        assertTrue(new WakeGate().allow(1, 14 * 60, 0, "12:00", "14:00"));
    }

    @Test public void aBlankOrMalformedWindowMeansNoWindow() {
        assertEquals(-1, WakeGate.parseHhmm(""));
        assertEquals(-1, WakeGate.parseHhmm(null));
        assertEquals(-1, WakeGate.parseHhmm("25:00"));
        assertEquals(-1, WakeGate.parseHhmm("9"));
        assertEquals(9 * 60 + 5, WakeGate.parseHhmm(" 9:05 "));
        assertTrue(new WakeGate().allow(1, 600, 0, "nonsense", "06:30"));
        assertTrue(new WakeGate().allow(1, 600, 0, "06:30", "06:30"));
    }

    @Test public void theCoolingCheckClaimsNothing() {
        WakeGate g = new WakeGate();
        assertFalse("nothing has woken yet", g.cooling(100_000, 8_000));
        assertTrue(g.allow(100_000, 600, 8_000, "", ""));
        assertTrue(g.cooling(100_050, 8_000));
        assertTrue(g.cooling(107_999, 8_000));
        assertFalse(g.cooling(108_000, 8_000));
        assertTrue("asking did not use up the wake", g.allow(108_000, 600, 8_000, "", ""));
        assertFalse("no cooldown, nothing to wait out", g.cooling(108_001, 0));
    }

    // The backend's manual screen-off hold: power.wakeSuppressUntilSec, epoch seconds.
    @Test public void suppressedUntilTMeansNoWakeBeforeTAndAWakeAfter() {
        WakeGate g = new WakeGate();
        long t = 1_800_000_000L;                                              // suppressed until T (seconds)
        assertFalse(g.allow(t * 1000 - 1, 600, 8_000, "", "", t));            // a note just before T
        assertFalse(g.allow(t * 1000 - 60_000, 600, 8_000, "", "", t));       // a minute before T
        assertTrue(g.allow(t * 1000, 600, 8_000, "", "", t));                 // at T: wakes
        assertTrue(new WakeGate().allow(t * 1000 + 5_000, 600, 8_000, "", "", t));  // after T: wakes
    }

    @Test public void aSuppressedNoteDoesNotUseUpTheCooldown() {
        WakeGate g = new WakeGate();
        long t = 1_800_000_000L;
        assertFalse(g.allow(t * 1000 - 100, 600, 8_000, "", "", t));
        assertFalse("nothing was claimed while suppressed", g.cooling(t * 1000 + 1, 8_000));
        assertTrue(g.allow(t * 1000 + 1, 600, 8_000, "", "", t));
    }

    @Test public void zeroOrAPastDeadlineSuppressesNothing() {
        assertFalse(WakeGate.suppressed(1_000, 0));
        assertFalse(WakeGate.suppressed(5_000_000, 4_999));                   // T already passed
        assertTrue(WakeGate.suppressed(4_998_999, 4_999));
        assertTrue(new WakeGate().allow(1_000, 600, 0, "", "", 0));
    }
}
