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

    @Test public void onlyAJobRunWithNoScreenCountsAsAFailure() {
        assertFalse("a screen open: its own timer retries", TelemetrySchedule.countsFailure(true, true));
        assertFalse("a flush with no payload could not have succeeded", TelemetrySchedule.countsFailure(false, false));
        assertTrue(TelemetrySchedule.countsFailure(false, true));
    }

    @Test public void theCapIsWhereTheWaitStopsGrowing() {
        int n = TelemetrySchedule.runsToCap();
        assertEquals(TelemetrySchedule.MAX_RETRY_MS, TelemetrySchedule.retryMs(n));
        assertTrue(TelemetrySchedule.retryMs(n - 1) < TelemetrySchedule.MAX_RETRY_MS);
        assertEquals(5, n);
    }

    @Test public void aPendingJobIsLeftAloneByAFlushThatCouldNotSucceed() {
        long fifteen = TelemetrySchedule.MAX_RETRY_MS;
        assertFalse("same wait, job not running: do not restart its clock", TelemetrySchedule.replacePending(fifteen, fifteen, false));
        assertFalse("a longer wait never pushes it out", TelemetrySchedule.replacePending(60_000L, fifteen, false));
    }

    @Test public void aShorterWaitANoJobOrTheJobsOwnRunReplaces() {
        assertTrue("none pending", TelemetrySchedule.replacePending(-1, 900_000L, false));
        assertTrue("the job reschedules itself after its run", TelemetrySchedule.replacePending(900_000L, 900_000L, true));
        assertTrue("shorter than the pending wait", TelemetrySchedule.replacePending(900_000L, 0, false));
    }

    @Test public void theNetworkReturningAtTheCapDrainsInSecondsNotFifteenMinutes() {
        long pending = TelemetrySchedule.retryMs(TelemetrySchedule.runsToCap());
        long onNetworkBack = TelemetrySchedule.NETWORK_BACK_MS;
        assertTrue(onNetworkBack <= 5_000L);
        assertTrue(TelemetrySchedule.replacePending(pending, onNetworkBack, false));
    }

    @Test public void aFlushInsideTheRunningJobNeverSchedulesTheJob() {
        assertFalse("scheduling the running id stops it", TelemetrySchedule.needsJob(4, false, true));
        assertTrue(TelemetrySchedule.needsJob(4, false, false));
        assertFalse(TelemetrySchedule.needsJob(0, false, false));
        assertFalse(TelemetrySchedule.needsJob(4, true, false));
    }
}
