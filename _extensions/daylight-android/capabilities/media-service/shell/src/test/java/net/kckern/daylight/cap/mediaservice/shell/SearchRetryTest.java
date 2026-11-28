package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.*;

import org.junit.Test;

public class SearchRetryTest {
    private long now = 1_000;
    private final SearchRetry r = new SearchRetry(() -> now);

    /** The reason strings the payload really sends (FailureReason) and the port wait's empty one. */
    @Test public void homeNotAnsweringRetriesEvery5sThreeTimesThenStops() {
        for (String reason : new String[] { "timeout", "home-error", "unreachable", "" }) {
            SearchRetry s = new SearchRetry(() -> now);
            s.begin("snakes");
            for (int i = 0; i < 3; i++) {
                assertEquals(reason, 5_000, s.failed("snakes", reason, true));
                assertTrue(s.timerFired("snakes") == false);
                now += 5_000;
                assertTrue(s.timerFired("snakes"));
                s.retryStarted("snakes");
            }
            assertEquals("the fourth failure gives up (the person has Try again)", SearchRetry.NONE, s.failed("snakes", reason, true));
        }
    }

    @Test public void noValidatedNetworkWaitsForTheNetworkNotATimer() {
        r.begin("snakes");
        assertEquals(SearchRetry.ON_NETWORK, r.failed("snakes", "unreachable", false));
        assertFalse("no timer is armed", r.timerFired("snakes"));
        assertTrue(r.networkBack("snakes"));
        assertFalse("one network callback starts one retry", r.networkBack("snakes"));
    }

    @Test public void theNetworkReturningCutsTheTimerShort() {
        r.begin("snakes");
        assertEquals(5_000, r.failed("snakes", "timeout", true));
        assertTrue(r.networkBack("snakes"));
        now += 5_000;
        assertFalse("the timer that was waiting must not run it a second time", r.timerFired("snakes"));
    }

    @Test public void aRetryIsDroppedWhenTheTextChanges() {
        r.begin("snakes");
        assertEquals(5_000, r.failed("snakes", "timeout", true));
        r.begin("snakes and arrows");
        now += 5_000;
        assertFalse(r.timerFired("snakes"));
        assertFalse(r.networkBack("snakes"));
        assertEquals("a failure of the old text plans nothing", SearchRetry.NONE, r.failed("snakes", "timeout", true));
    }

    @Test public void clearingTheFieldDropsEverything() {
        r.begin("snakes");
        r.failed("snakes", "unreachable", false);
        r.cancel();
        assertFalse(r.networkBack("snakes"));
    }

    @Test public void reasonsThatAnotherTryWontFixAreNotRetried() {
        for (String reason : new String[] { "refused", "not-found", "bad-request", "starting" }) {
            r.begin("x");
            assertEquals(reason, SearchRetry.NONE, r.failed("x", reason, true));
        }
    }

    @Test public void aTypedOrTappedSearchStartsTheCountAgain() {
        r.begin("snakes");
        for (int i = 0; i < 3; i++) { r.failed("snakes", "timeout", true); now += 5_000; r.timerFired("snakes"); r.retryStarted("snakes"); }
        assertEquals(SearchRetry.NONE, r.failed("snakes", "timeout", true));
        r.begin("snakes");
        assertEquals(5_000, r.failed("snakes", "timeout", true));
    }

    @Test public void aSuccessEndsTheWaiting() {
        r.begin("snakes");
        r.failed("snakes", "timeout", true);
        r.succeeded("snakes");
        now += 5_000;
        assertFalse(r.timerFired("snakes"));
        assertFalse(r.networkBack("snakes"));
    }

    @Test public void whatTheScreenSaysFollowsTheState() {
        r.begin("snakes");
        assertEquals(SearchRetry.Waiting.NONE, r.waiting("snakes"));
        r.failed("snakes", "timeout", true);
        assertEquals(SearchRetry.Waiting.TIMER, r.waiting("snakes"));
        r.begin("snakes");
        r.failed("snakes", "timeout", false);
        assertEquals(SearchRetry.Waiting.NETWORK, r.waiting("snakes"));
    }
}
