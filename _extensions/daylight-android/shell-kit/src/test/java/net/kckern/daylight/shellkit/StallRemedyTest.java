package net.kckern.daylight.shellkit;

import static net.kckern.daylight.shellkit.StallRemedy.Step.NONE;
import static net.kckern.daylight.shellkit.StallRemedy.Step.READD;
import static net.kckern.daylight.shellkit.StallRemedy.Step.RESUME;
import static net.kckern.daylight.shellkit.StallRemedy.Step.STOP;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class StallRemedyTest {
    @Test public void nothingHappensUntilAStallBegins() {
        StallRemedy r = new StallRemedy();
        assertEquals(NONE, r.step(0, false, false));
        assertFalse(r.active());
    }

    @Test public void stopsFirstAndResumesOnlyAfterTheManagerSaysStopped() {
        StallRemedy r = new StallRemedy();
        r.begin(0);
        assertEquals(STOP, r.step(0, false, false));
        assertEquals("not back to back", NONE, r.step(500, false, false));
        assertEquals(RESUME, r.step(600, true, false));
    }

    @Test public void resumesAfterTwoSecondsWhenStoppedIsNeverReported() {
        StallRemedy r = new StallRemedy();
        r.begin(0);
        r.step(0, false, false);
        assertEquals(NONE, r.step(1_999, false, false));
        assertEquals(RESUME, r.step(2_000, false, false));
    }

    @Test public void twentySecondsAfterTheResumeWithNoBytesItIsReadded() {
        StallRemedy r = new StallRemedy();
        r.begin(0);
        r.step(0, false, false);
        r.step(2_000, false, false);
        assertEquals(NONE, r.step(21_999, false, false));
        assertEquals(READD, r.step(22_000, false, false));
        assertEquals("the strong step is once", NONE, r.step(60_000, false, false));
    }

    @Test public void bytesComingAtAnyPointEndsTheEpisodeAndAllowsALaterOne() {
        StallRemedy r = new StallRemedy();
        r.begin(0);
        r.step(0, false, false);
        r.step(2_000, false, false);
        assertEquals(NONE, r.step(10_000, false, true));
        assertFalse(r.active());
        assertEquals("no second step now", NONE, r.step(30_000, false, false));
        r.begin(40_000);
        assertEquals(STOP, r.step(40_000, false, false));
    }

    @Test public void beginWhileAnEpisodeRunsChangesNothing() {
        StallRemedy r = new StallRemedy();
        r.begin(0);
        r.step(0, false, false);
        r.begin(1_000);
        assertEquals(NONE, r.step(1_000, false, false));
        assertTrue(r.active());
    }
}
