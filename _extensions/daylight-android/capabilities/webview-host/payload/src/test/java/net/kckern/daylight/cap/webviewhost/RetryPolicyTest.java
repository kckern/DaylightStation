package net.kckern.daylight.cap.webviewhost;

import static org.junit.Assert.*;

import org.junit.Test;

public class RetryPolicyTest {
    @Test public void doublesFromTheBaseUpToTheCeiling() {
        assertEquals(30_000, RetryPolicy.delayMs(1, 30, 300));
        assertEquals(60_000, RetryPolicy.delayMs(2, 30, 300));
        assertEquals(120_000, RetryPolicy.delayMs(3, 30, 300));
        assertEquals(240_000, RetryPolicy.delayMs(4, 30, 300));
        assertEquals(300_000, RetryPolicy.delayMs(5, 30, 300));
        assertEquals(300_000, RetryPolicy.delayMs(500, 30, 300));
    }

    @Test public void zeroBaseDisablesRetry() {
        assertEquals(-1, RetryPolicy.delayMs(1, 0, 300));
        assertEquals(-1, RetryPolicy.delayMs(0, 30, 300));
    }

    @Test public void aCeilingBelowTheBaseMeansAConstantDelay() {
        assertEquals(30_000, RetryPolicy.delayMs(4, 30, 10));
    }

    @Test public void theNetworkReturningReloadsOnlyAFailedPage() {
        assertTrue(RetryPolicy.reloadOnNetworkReturn(true, LoadTracker.State.FAILED));
        assertFalse("a healthy page is never remounted for a network blip",
                RetryPolicy.reloadOnNetworkReturn(true, LoadTracker.State.LOADED));
        assertFalse(RetryPolicy.reloadOnNetworkReturn(true, LoadTracker.State.LOADING));
        assertFalse(RetryPolicy.reloadOnNetworkReturn(false, LoadTracker.State.FAILED));
    }

    @Test public void aPageInitiatedAddressThatKeepsFailingIsGivenUpForTheStartPage() {
        String start = "https://kiosk.example/screen/piano";
        String dead = "https://kiosk.example/gone";
        assertFalse(RetryPolicy.abandonForStart(1, dead, start));
        assertFalse(RetryPolicy.abandonForStart(RetryPolicy.GIVE_UP_AFTER - 1, dead, start));
        assertTrue(RetryPolicy.abandonForStart(RetryPolicy.GIVE_UP_AFTER, dead, start));
        assertTrue(RetryPolicy.abandonForStart(50, dead, start));
    }

    @Test public void theStartPageItselfIsRetriedForAsLongAsItTakes() {
        String start = "https://kiosk.example/screen/piano";
        assertFalse(RetryPolicy.abandonForStart(500, start, start));
        assertFalse("a fragment or a trailing slash is the same page", RetryPolicy.abandonForStart(500, start + "/#top", start));
        assertFalse("nothing to go back to", RetryPolicy.abandonForStart(500, "https://kiosk.example/gone", ""));
    }
}
