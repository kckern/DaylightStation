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
        s.notePrevious("plex:1", 0);
        // Still Y: playing for a while, even a change event, never counts.
        assertFalse(s.landed("plex:1", "", false, true, false, true));
        // Our own request, not the item yet.
        assertFalse(s.landed("p:plex:20|plex:9", "", true, true, true, true));
        // X itself: at once.
        assertTrue(s.landed("plex:20", "plex:9", false, false, false, false));
        // A first track of a tapped playlist (unknown id), after a change: landed.
        Starting list = new Starting("local", "c:plex:50", "Mix", "", "", 0);
        list.notePrevious("plex:1", 0);
        assertTrue(list.landed("plex:77", "plex:50", false, false, false, false));
        assertTrue(list.landed("plex:77", "", false, true, false, false));
        assertFalse(list.landed("plex:1", "", false, true, true, true));
    }

    @Test public void thePreviousItemIsTheFirstOneSeen() {
        Starting s = Starting.bare("local", "c:plex:2", 0);
        s.notePrevious("plex:1", 0);
        s.notePrevious("plex:2", 0);
        assertEquals("plex:1", s.previous);
    }

    @Test public void anItemFirstSeenAfterTheTapIsNotThePreviousOne() {
        // A kept album resolves at once: the player has X before Now playing's controller connects.
        Starting s = new Starting("local", "c:plex:50", "Mix", "", "", 1_000);
        s.notePrevious("plex:77", 1_200);
        assertNull(s.previous);
        assertTrue("playing a while is enough", s.landed("plex:77", "", false, false, false, true));
        Starting fromNote = new Starting("local", "", "Mix", "", "", 1_000);
        fromNote.notePrevious("plex:77", 1_200);
        assertTrue(fromNote.landed("plex:77", "", false, false, true, true));
    }

    @Test public void thePreviousItemPassedAtTheTapIsNeverLanded() {
        Starting s = new Starting("local", "c:plex:50", "Mix", "", "", 1_000);
        s.previousAtTap("p:plex:9");
        s.notePrevious("plex:77", 0); // the tap's answer wins
        assertEquals("plex:9", s.previous);
        assertFalse(s.landed("plex:9", "", false, true, true, true));
        assertTrue(s.landed("plex:77", "", false, false, false, true));
        Starting nothing = new Starting("local", "c:plex:50", "Mix", "", "", 1_000);
        nothing.previousAtTap("");
        assertEquals("nothing was playing at the tap", "", nothing.previous);
        assertTrue(nothing.landed("plex:77", "", false, false, false, true));
    }

    private static net.kckern.daylight.shellkit.NowPlayingNote.Entry note(String id, boolean starting) {
        return new net.kckern.daylight.shellkit.NowPlayingNote.Entry("local", "This phone", "Y", "", "", true, false, 0, -1, 0,
                null, starting, "", id);
    }

    @Test public void theTappingScreenSaysWhatPlayedAtTheTap() {
        // Its own connected controller first; a request still resolving is not an item.
        assertEquals("plex:9", Starting.previousAt(true, "plex:9", note("plex:1", false)));
        assertNull("a request still resolving: not known", Starting.previousAt(true, "c:plex:4", null));
        assertEquals("", Starting.previousAt(true, null, note("plex:1", false)));
        // Not connected yet: the mini player's last report, made before the tap.
        assertEquals("plex:1", Starting.previousAt(false, null, note("plex:1", false)));
        assertEquals("nothing loaded", "", Starting.previousAt(false, null, null));
        // Another start in flight, or a report with no id: not known.
        assertNull(Starting.previousAt(false, null, note("", true)));
        assertNull(Starting.previousAt(false, null, note("", false)));
    }

    @Test public void ofReadsThePreviousExtraAsFromPassesIt() {
        // Starting.from(Intent) reads its extras into Starting.of (Android's Intent is not available to JVM tests).
        Starting s = Starting.of("local", 1_000, "c:plex:50", "Mix", "", "", /*play*/ false, /*longForm*/ false, "p:plex:9");
        assertEquals("plex:9", s.previous);
        assertFalse(s.landed("plex:9", "", false, true, true, true));
        Starting none = Starting.of("local", 1_000, "c:plex:50", "Mix", "", "", /*play*/ false, /*longForm*/ false, "");
        assertEquals("", none.previous);
        Starting absent = Starting.of("local", 1_000, "c:plex:50", "Mix", "", "", /*play*/ false, /*longForm*/ false, null);
        assertNull("no extra: not known", absent.previous);
        assertNull("nothing to show", Starting.of("local", 0, null, "  ", null, null, /*play*/ false, /*longForm*/ false, null));
        assertTrue(Starting.of("local", 0, "c:plex:1", "Book", "", "", /*play*/ true, /*longForm*/ true, null).longForm);
    }

    @Test public void withNoPreviousFromTheTapTheMiniPlayersReportIsIt() {
        // A launcher that sets no starting.previous: the bar's report, read before the start replaced it.
        Starting s = new Starting("local", "c:plex:50", "Mix", "", "", 1_000);
        s.previousFromNote(note("plex:1", false));
        assertEquals("plex:1", s.previous);
        // The old track still plays at 2 s (a slow resolve): not landed.
        assertFalse(s.landed("plex:1", "", false, false, false, true));
        assertTrue(s.landed("plex:77", "", false, false, false, true));
        // A start already showing on the bar: not known, so the timestamp rule stands.
        Starting t = new Starting("local", "c:plex:50", "Mix", "", "", 1_000);
        t.previousFromNote(note("", true));
        assertNull(t.previous);
        // The tap's own answer is never replaced.
        Starting u = new Starting("local", "c:plex:50", "Mix", "", "", 1_000);
        u.previousAtTap("plex:9");
        u.previousFromNote(note("plex:1", false));
        assertEquals("plex:9", u.previous);
    }

    @Test public void reTappingThePlayingAlbumLandsOnceThePlayerReloadedIt() {
        Starting s = new Starting("local", "c:plex:50", "The Album", "", "", 1_000);
        s.previousAtTap("plex:77"); // its first track was playing
        assertFalse(s.landed("plex:77", "", false, true, true, true, false));
        // The service answered the tap and the player changed after that: what it holds is the answer.
        assertTrue(s.landed("plex:77", "", false, true, false, false, true));
        assertFalse("never our own request", s.landed("c:plex:50", "", true, true, false, false, true));
    }

    @Test public void theAnswerToATapCountsOnlyForThatTapAndAfterIt() {
        Starting.answered("c:plex:50", 1_200);
        Starting s = new Starting("local", "c:plex:50", "The Album", "", "", 1_000);
        assertTrue("seen after the answer", s.reloadedSinceAnswer(1_250));
        assertFalse("seen before it", s.reloadedSinceAnswer(1_100));
        Starting other = new Starting("local", "c:plex:60", "Another", "", "", 1_000);
        assertFalse(other.reloadedSinceAnswer(1_250));
        Starting later = new Starting("local", "c:plex:50", "The Album", "", "", 1_300);
        assertFalse("an answer to an earlier tap", later.reloadedSinceAnswer(1_400));
    }
}
