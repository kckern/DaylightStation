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
                assertEquals("early: the remaining wait, still waiting", 5_000, s.timerFired("snakes"));
                now += 5_000;
                assertEquals(SearchRetry.FIRE, s.timerFired("snakes"));
                s.retryStarted("snakes");
            }
            assertEquals("the fourth failure gives up (the person has Try again)", SearchRetry.NONE, s.failed("snakes", reason, true));
        }
    }

    @Test public void noValidatedNetworkWaitsForTheNetworkNotATimer() {
        r.begin("snakes");
        assertEquals(SearchRetry.ON_NETWORK, r.failed("snakes", "unreachable", false));
        assertEquals("no timer is armed", SearchRetry.STALE, r.timerFired("snakes"));
        assertTrue(r.networkBack("snakes"));
        assertFalse("one network callback starts one retry", r.networkBack("snakes"));
    }

    /** Signal and bandwidth changes fire the callback again and again: they must not burn the tries. */
    @Test public void aFlappingNetworkNeverCutsTheBackoffShort() {
        r.begin("snakes");
        assertEquals(5_000, r.failed("snakes", "timeout", true));
        for (int i = 0; i < 20; i++) { now += 100; assertFalse(r.networkBack("snakes")); }
        assertEquals("the timer still waits out what is left", 3_000, r.timerFired("snakes"));
        now += 3_000;
        assertEquals(SearchRetry.FIRE, r.timerFired("snakes"));
        r.retryStarted("snakes");
        assertEquals("two tries are still left", 5_000, r.failed("snakes", "timeout", true));
        now += 5_000;
        assertEquals(SearchRetry.FIRE, r.timerFired("snakes"));
        r.retryStarted("snakes");
        assertEquals(5_000, r.failed("snakes", "timeout", true));
    }

    @Test public void aTimerThatFiresEarlyKeepsWaiting() {
        r.begin("snakes");
        r.failed("snakes", "timeout", true);
        now += 1_000;
        assertEquals(4_000, r.timerFired("snakes"));
        assertEquals(SearchRetry.Waiting.TIMER, r.waiting("snakes"));
    }

    @Test public void aRetryIsDroppedWhenTheTextChanges() {
        r.begin("snakes");
        assertEquals(5_000, r.failed("snakes", "timeout", true));
        r.begin("snakes and arrows");
        now += 5_000;
        assertEquals(SearchRetry.STALE, r.timerFired("snakes"));
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
        for (String reason : new String[] { "refused", "not-found", "not_found", "bad-request", "bad_request", "unauthorized", "forbidden", "starting" }) {
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
        assertEquals(SearchRetry.STALE, r.timerFired("snakes"));
        assertFalse(r.networkBack("snakes"));
    }

    @Test public void anUnknownReasonIsRetriedLikeTheWordsSayHomeIsSlow() {
        r.begin("x");
        assertEquals(5_000, r.failed("x", "something-new", true));
    }

    /**
     * The words (FailureWords.cause) and the retry must agree. The payload can emit only these
     * reasons (FailureReasonTest holds the same list on its side), plus the port's empty one
     * and "starting".
     */
    @Test public void theRetryAgreesWithTheWordsForEveryReasonThePayloadCanSend() {
        String[] emitted = { "timeout", "home-error", "unreachable", "not-found", "refused", "bad-request", "", "starting", "something-new" };
        for (String reason : emitted) {
            boolean slow = net.kckern.daylight.shellkit.FailureWords.cause(reason, true)
                    == net.kckern.daylight.shellkit.FailureWords.Cause.HOME_SLOW;
            // The one known difference: FailureWords has no cause for a 400 and says "Home isn't
            // answering"; asking the same bad request again cannot help, so it is never retried.
            if (reason.equals("bad-request")) { assertTrue(slow); assertFalse(SearchRetry.retryable(reason)); continue; }
            assertEquals("'" + reason + "'", slow, SearchRetry.retryable(reason));
        }
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
