package net.kckern.daylight.cap.lockdown;

import static org.junit.Assert.*;

import org.junit.Test;

public class RecallPacerTest {
    @Test public void theFirstFewRecallsOfARunGoOutEveryTick() {
        RecallPacer p = new RecallPacer();
        for (int i = 0; i < RecallPacer.FREE; i++) assertTrue("recall " + (i + 1), p.due(1_000L * i));
        assertEquals(RecallPacer.FREE, p.consecutive());
    }

    @Test public void aRecallThatKeepsNotTakingBacksOffToTheCeiling() {
        RecallPacer p = new RecallPacer();
        long now = 0;
        for (int i = 0; i < RecallPacer.FREE; i++) { assertTrue(p.due(now)); now += 1_000; }
        assertFalse("the fourth waits", p.due(now));                              // 1 s after the third
        now += 1_000;
        assertTrue(p.due(now));                                                   // 2 s after it
        assertFalse(p.due(now + 3_999));
        assertTrue("then 4 s", p.due(now + 4_000));
        assertEquals(0, RecallPacer.gapBefore(1));
        assertEquals(0, RecallPacer.gapBefore(RecallPacer.FREE));
        assertEquals(RecallPacer.FIRST_GAP_MS, RecallPacer.gapBefore(RecallPacer.FREE + 1));
        assertEquals(RecallPacer.MAX_GAP_MS, RecallPacer.gapBefore(50));
        assertEquals("no overflow far out", RecallPacer.MAX_GAP_MS, RecallPacer.gapBefore(Integer.MAX_VALUE));
    }

    @Test public void aTickWithNothingToRecallEndsTheRun() {
        RecallPacer p = new RecallPacer();
        long now = 0;
        for (int i = 0; i < RecallPacer.FREE + 2; i++) { p.due(now); now += 10_000; }
        p.settled();
        assertEquals(0, p.consecutive());
        assertTrue("the next escape is recalled at once", p.due(now));
        assertTrue(p.due(now + 1_000));
    }

    @Test public void noMinuteHoldsMoreThanTheCap() {
        // Escape, recall, escape again, every second: each run is one recall long.
        RecallPacer p = new RecallPacer();
        int made = 0;
        for (long now = 0; now < 60_000; now += 1_000) {
            if (p.due(now)) made++;
            p.settled();
        }
        assertEquals(RecallPacer.MAX_PER_MINUTE, made);
        assertTrue("and the next minute has its own", p.due(60_000 + 11_000));
    }

    @Test public void aWatcherThatMissedHoursDoesNotOweTheirRecalls() {
        // The fixed-rate timer replayed every missed second after a suspend. The pacer
        // holds whatever calls it: 28,800 calls at one instant make three recalls.
        RecallPacer p = new RecallPacer();
        int made = 0;
        for (int i = 0; i < 28_800; i++) if (p.due(5_000)) made++;
        assertEquals(RecallPacer.FREE, made);
    }
}
