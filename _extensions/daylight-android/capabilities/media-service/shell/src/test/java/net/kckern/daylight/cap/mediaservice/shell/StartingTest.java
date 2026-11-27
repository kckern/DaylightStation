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
        assertEquals("Couldn't start this · tap Play to try again", s.line(1_000 + Starting.GIVE_UP_MS, ""));
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
        assertEquals("Office didn't start it", s.line(Starting.GIVE_UP_MS, "Office"));
        assertFalse(s.retryable(Starting.GIVE_UP_MS));
    }
}
