package net.kckern.daylight.cap.mediaservice.shell;

import org.junit.Test;

import static org.junit.Assert.*;

public class StartingTest {
    @Test public void startingThenSlowThenFailedWithRetryOnThisPhone() {
        Starting s = new Starting("local", "c:plex:1", "The Book", "The Author", "", 1_000);
        assertEquals(Starting.Phase.STARTING, s.phase(1_000));
        assertEquals("Starting…", s.line(1_000, ""));
        assertFalse(s.retryable(1_000));
        assertEquals(Starting.Phase.SLOW, s.phase(1_000 + Starting.SLOW_MS));
        assertEquals("Still starting… home is slow", s.line(1_000 + Starting.SLOW_MS, ""));
        assertEquals(Starting.Phase.FAILED, s.phase(1_000 + Starting.GIVE_UP_MS));
        assertTrue(s.retryable(1_000 + Starting.GIVE_UP_MS));
        assertEquals("Couldn't start The Book · tap to try again", s.failedLine(""));
    }

    @Test public void aPlayerErrorFailsAtOnce() {
        Starting s = new Starting("local", "c:plex:1", "The Book", null, null, 0);
        s.fail();
        assertEquals(Starting.Phase.FAILED, s.phase(1));
        assertEquals("", s.subtitle);
    }

    @Test public void aScreenNamesItselfAndANoIdStartCannotRetry() {
        Starting s = new Starting("office-tv", "", "Morning", "", "", 0);
        assertEquals("Starting on Office…", s.line(0, "Office"));
        assertEquals("Office didn't start Morning", s.failedLine("Office"));
        assertEquals("Couldn't start Morning", s.failedLine(""));
        assertFalse(s.retryable(Starting.GIVE_UP_MS));
    }

    @org.junit.Test public void aRefusedStartSaysWhy() {
        org.junit.Assert.assertEquals("home isn't answering", Starting.whyWords("unreachable", true));
        org.junit.Assert.assertEquals("offline", Starting.whyWords("unreachable", false));
        org.junit.Assert.assertEquals("home does not have it", Starting.whyWords("not_found", true));
        org.junit.Assert.assertEquals("home refused this phone", Starting.whyWords("backend_refused", true));
        org.junit.Assert.assertEquals("", Starting.whyWords("", true));
    }
}
