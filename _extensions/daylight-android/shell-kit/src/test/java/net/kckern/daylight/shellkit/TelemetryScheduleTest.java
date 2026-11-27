package net.kckern.daylight.shellkit;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class TelemetryScheduleTest {
    @Test public void heldBatchesWhenTheLastScreenClosesScheduleASend() {
        assertTrue(TelemetrySchedule.needsJob(4, false));
    }

    @Test public void nothingHeldNothingScheduled() {
        assertFalse(TelemetrySchedule.needsJob(0, false));
    }

    @Test public void anOpenScreenSendsOnItsOwnTimer() {
        assertFalse(TelemetrySchedule.needsJob(4, true));
    }

    @Test public void aRunThatLeftBatchesAsksAgainWithBackoff() {
        assertEquals(30_000L, TelemetrySchedule.retryMs(0));
        assertEquals(60_000L, TelemetrySchedule.retryMs(1));
        assertEquals(15 * 60_000L, TelemetrySchedule.retryMs(10));
        assertEquals("never hours apart", 15 * 60_000L, TelemetrySchedule.retryMs(1000));
    }
}
