package net.kckern.daylight.cap.quickinput.shell;

import static org.junit.Assert.*;

import net.kckern.daylight.cap.quickinput.shell.CaptureScopeWait.Step;

import org.junit.Test;

public class CaptureScopeWaitTest {
    private static final String ME = "a".repeat(64), OTHER = "b".repeat(64);

    @Test public void theBoundAccountIsReady() {
        assertEquals(Step.READY, CaptureScopeWait.step(ME, ME, true, null, 0, 0, 0));
    }

    @Test public void anotherAccountIsUnavailableAtOnce() {
        assertEquals(Step.UNAVAILABLE, CaptureScopeWait.step(ME, OTHER, true, null, 0, 0, 0));
    }

    @Test public void aColdStartIsWaitedForPastTheOldFiveSeconds() {
        assertEquals("12 s into a cold start: still starting, not unavailable",
                Step.WAIT_STARTING, CaptureScopeWait.step(ME, null, false, null, 12_000, 0, 0));
        assertEquals(Step.UNAVAILABLE, CaptureScopeWait.step(ME, null, false, null, 26_000, 0, 0));
    }

    @Test public void theBindingGetsItsSecondsFromWhenThePayloadCameUp() {
        assertEquals(Step.WAIT_CHECKING, CaptureScopeWait.step(ME, null, true, null, 15_000, 0, 14_000));
        assertEquals(Step.UNAVAILABLE, CaptureScopeWait.step(ME, null, true, null, 19_500, 0, 14_000));
    }

    @Test public void aLoaderFailureSaysSo() {
        assertEquals(Step.FAILED, CaptureScopeWait.step(ME, null, false, "start() threw", 3_000, 0, 0));
    }

    @org.junit.Test public void aHeldDraftSaysItIsKeptAndWhy() {
        org.junit.Assert.assertEquals("Your text is saved on this phone. " + CaptureScopeWait.UNAVAILABLE,
                CaptureScopeWait.heldWords("Your text", ""));
        org.junit.Assert.assertEquals("Your photo is saved on this phone. Could not start.",
                CaptureScopeWait.heldWords("Your photo", "Could not start."));
    }
}
