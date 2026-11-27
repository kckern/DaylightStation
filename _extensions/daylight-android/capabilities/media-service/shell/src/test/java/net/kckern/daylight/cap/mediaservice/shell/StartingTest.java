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

    @Test public void whileStartingTheOldItemIsNeverShown() {
        Starting s = new Starting("local", "c:plex:2", "X", "by X", "artX", 0);
        assertTrue(s.suppresses("p:plex:1"));          // Y, the previous item
        assertFalse(s.suppresses("p:plex:2|c:plex:2")); // X's own item
        assertTrue(s.suppresses("plex:1"));
        assertFalse(s.suppresses("plex:2"));
    }

    @Test public void aStartWithNoTitleStillSuppresses() {
        Starting s = Starting.bare("local", "c:plex:2", 0); // tapped from somewhere with no title
        assertEquals("Starting…", s.line(0, ""));
        assertTrue(s.suppresses("p:plex:1"));
    }

    @Test public void aTappedTrackIsItselfNotAnotherTrackOfItsAlbum() {
        Starting s = new Starting("local", "p:plex:20|plex:9", "Track 3", "", "", 0);
        assertFalse(s.suppresses("plex:20"));
        assertTrue("track 1 of the same album is not the tapped track", s.suppresses("plex:21|plex:9"));
    }

    @Test public void thePreviousItemPlayingOnIsNeverTheNewOne() {
        Starting s = new Starting("local", "p:plex:20|plex:9", "Track 3", "", "", 0);
        s.notePrevious("plex:1");
        // Still Y: playing for a while, even a change event, never counts.
        assertFalse(s.landed("plex:1", "", false, true, false, true));
        // Our own request, not the item yet.
        assertFalse(s.landed("p:plex:20|plex:9", "", true, true, true, true));
        // X itself: at once.
        assertTrue(s.landed("plex:20", "plex:9", false, false, false, false));
        // A first track of a tapped playlist (unknown id), after a change: landed.
        Starting list = new Starting("local", "c:plex:50", "Mix", "", "", 0);
        list.notePrevious("plex:1");
        assertTrue(list.landed("plex:77", "plex:50", false, false, false, false));
        assertTrue(list.landed("plex:77", "", false, true, false, false));
        assertFalse(list.landed("plex:1", "", false, true, true, true));
    }

    @Test public void thePreviousItemIsTheFirstOneSeen() {
        Starting s = Starting.bare("local", "c:plex:2", 0);
        s.notePrevious("plex:1");
        s.notePrevious("plex:2");
        assertEquals("plex:1", s.previous);
    }
}
