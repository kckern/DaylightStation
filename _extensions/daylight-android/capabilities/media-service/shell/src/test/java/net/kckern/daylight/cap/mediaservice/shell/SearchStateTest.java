package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.*;

import net.kckern.daylight.shellkit.FailureWords.Cause;

import org.junit.Test;

public class SearchStateTest {
    private static final SearchRetry.Waiting NO = SearchRetry.Waiting.NONE, TIMER = SearchRetry.Waiting.TIMER, NET = SearchRetry.Waiting.NETWORK;

    @Test public void onlyARealEmptyAnswerFromHomeSaysNothingCalled() {
        SearchState s = SearchState.of("abbey", true, false, 0, null, NO);
        assertEquals("Nothing called \"abbey\". Try fewer words.", s.line);
        assertFalse(s.tryAgain);
        for (Cause c : Cause.values()) for (SearchRetry.Waiting w : SearchRetry.Waiting.values()) {
            assertFalse("a failed search never says nothing was found: " + c + " " + w,
                    SearchState.of("abbey", false, false, 0, c, w).line.startsWith("Nothing called"));
            assertFalse(SearchState.of("abbey", true, true, 0, c, w).line.startsWith("Nothing called"));
            assertTrue(SearchState.of("abbey", false, false, 0, c, w).tryAgain);
        }
    }

    @Test public void aFailureSaysWhyAndWhatHappensNext() {
        assertEquals("Home isn't answering · trying again", SearchState.of("x", false, false, 0, Cause.HOME_SLOW, TIMER).line);
        assertEquals("Home isn't answering", SearchState.of("x", false, false, 0, Cause.HOME_SLOW, NO).line);
        assertEquals("Offline · showing what's on this phone · will try again when you're back online",
                SearchState.of("x", false, false, 0, Cause.OFFLINE, NET).line);
    }

    @Test public void keptOnlyAnswersSaySoAndOfferTryAgain() {
        SearchState some = SearchState.of("x", true, true, 3, Cause.HOME_SLOW, TIMER);
        assertEquals("Home isn't answering · searching what's on this phone · trying again", some.line);
        assertTrue(some.tryAgain);
        SearchState none = SearchState.of("abbey", true, true, 0, Cause.OFFLINE, NET);
        assertEquals("Offline · searching what's on this phone · nothing kept matches \"abbey\". Will try again when you're back online.", none.line);
        assertTrue(none.tryAgain);
        assertEquals("Home isn't answering · searching what's on this phone · nothing kept matches \"abbey\". Trying again…",
                SearchState.of("abbey", true, true, 0, Cause.HOME_SLOW, TIMER).line);
    }

    @Test public void resultsFromHomeSayNothingAndOfferNoTryAgain() {
        SearchState s = SearchState.of("x", true, false, 4, null, NO);
        assertEquals("", s.line);
        assertFalse(s.tryAgain);
    }
}
