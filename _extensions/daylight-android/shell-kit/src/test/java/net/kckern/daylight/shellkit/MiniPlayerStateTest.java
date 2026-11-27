package net.kckern.daylight.shellkit;

import static org.junit.Assert.*;

import org.junit.Test;

public class MiniPlayerStateTest {
    private static NowPlayingNote.Entry e(String target, String title, boolean playing, long at, boolean starting, String detail) {
        return new NowPlayingNote.Entry(target, "Office", title, "Boethius", "", playing, false, 0, 60_000, at, null, starting, detail);
    }

    @Test public void upWhenThereIsAnItemNeverNothingPlaying() {
        assertFalse(MiniPlayerState.shown(null, "", 0));
        assertTrue(MiniPlayerState.shown(e("local", "Book", false, 0, false, ""), "", 10));
    }

    /** A paused item is up like a playing one; with no entry and a saved queue the screen wakes the service. */
    @Test public void pausedShowsAndAMissingEntryWakesTheSavedQueue() {
        assertTrue(MiniPlayerState.shown(e("local", "Spindrift", false, 0, false, ""), "", 600_000));
        assertTrue(MiniPlayerState.shown(e("local", "Spindrift", true, 0, false, ""), "", 600_000));
        assertTrue(MiniPlayerState.wake(null, true));
        assertFalse(MiniPlayerState.wake(null, false));
        assertFalse(MiniPlayerState.wake(e("local", "Spindrift", false, 0, false, ""), true));
    }

    @Test public void aSwipeDownHoldsUntilTheNextItem() {
        NowPlayingNote.Entry a = e("local", "Book", true, 0, false, "");
        String hid = MiniPlayerState.key(a);
        assertFalse(MiniPlayerState.shown(a, hid, 10));
        assertTrue(MiniPlayerState.shown(e("local", "Next book", true, 0, false, ""), hid, 10));
    }

    @Test public void theSecondLine() {
        assertEquals("Starting…", MiniPlayerState.line(e("local", "Book", false, 0, true, "")));
        assertEquals("On Office", MiniPlayerState.line(e("tv", "Book", true, 0, false, "")));
        assertEquals("Chapter 2 of 9", MiniPlayerState.line(e("local", "Book", true, 0, false, "Chapter 2 of 9")));
        assertEquals("Boethius", MiniPlayerState.line(e("local", "Book", true, 0, false, "")));
    }

    @Test public void aStartThatNeverPlaysGoes() {
        NowPlayingNote.Entry s = e("local", "Book", false, 0, true, "");
        assertTrue(MiniPlayerState.shown(s, "", 1000));
        assertFalse(MiniPlayerState.shown(s, "", MiniPlayerState.STARTING_MS + 1));
    }

    /** Play/Pause flips at once and the player's next report has the last word. */
    @Test public void playPauseIsOptimistic() {
        NowPlayingNote.Entry playing = e("local", "Book", true, 100, false, "");
        assertFalse(MiniPlayerState.playing(playing, 200, false));
        assertTrue(MiniPlayerState.playing(e("local", "Book", true, 300, false, ""), 200, false));
        assertTrue(MiniPlayerState.playing(playing, -1, false));
    }
}
