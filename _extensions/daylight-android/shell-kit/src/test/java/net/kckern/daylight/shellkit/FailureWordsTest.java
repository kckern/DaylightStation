package net.kckern.daylight.shellkit;

import static org.junit.Assert.*;

import net.kckern.daylight.shellkit.FailureWords.Cause;

import org.junit.Test;

public class FailureWordsTest {
    @Test public void noNetworkIsOfflineWhateverHomeSaid() {
        assertEquals(Cause.OFFLINE, FailureWords.cause("timeout", false));
        assertEquals(Cause.OFFLINE, FailureWords.cause("", false));
        assertEquals("Offline · showing what's on this phone", FailureWords.line(Cause.OFFLINE));
    }

    @Test public void aSlowHomeOnAWorkingNetworkIsNotOffline() {
        assertEquals(Cause.HOME_SLOW, FailureWords.cause("timeout", true));
        assertEquals(Cause.HOME_SLOW, FailureWords.cause("home-error", true));
        assertEquals(Cause.HOME_SLOW, FailureWords.cause("unreachable", true));
        assertEquals(Cause.HOME_SLOW, FailureWords.cause("", true));
        assertEquals("Home isn't answering", FailureWords.line(Cause.HOME_SLOW));
        assertTrue(FailureWords.retryable(Cause.HOME_SLOW));
    }

    @Test public void notFoundAndRefusedSayWhatHomeSaid() {
        assertEquals(Cause.NOT_FOUND, FailureWords.cause("not-found", true));
        assertEquals(Cause.NOT_FOUND, FailureWords.cause("not_found", true));
        assertEquals(Cause.REFUSED, FailureWords.cause("refused", true));
        assertEquals("Not found at home", FailureWords.line(Cause.NOT_FOUND));
        assertEquals("Home refused this phone", FailureWords.line(Cause.REFUSED));
        assertFalse(FailureWords.retryable(Cause.NOT_FOUND));
    }

    @Test public void theHeadIsTheFirstWords() {
        assertEquals("Offline", FailureWords.head(Cause.OFFLINE));
        assertEquals("Home isn't answering", FailureWords.head(Cause.HOME_SLOW));
    }

    @Test public void startingIsItsOwnLine() {
        assertEquals(Cause.STARTING, FailureWords.cause("starting", false));
        assertEquals(PayloadReady.STARTING, FailureWords.line(Cause.STARTING));
    }

    @Test public void theReasonOfAnAnswerFallsBackToItsErrorCode() throws Exception {
        assertEquals("timeout", FailureWords.reasonOf(new org.json.JSONObject("{\"ok\":false,\"error\":\"unreachable\",\"reason\":\"timeout\"}")));
        assertEquals("not_found", FailureWords.reasonOf(new org.json.JSONObject("{\"ok\":false,\"error\":\"not_found\"}")));
        assertEquals("", FailureWords.reasonOf(null));
    }
}
