package net.kckern.daylight.shellkit;

import org.junit.Test;

import static net.kckern.daylight.shellkit.PlaylistWidgetState.Phase.*;
import static net.kckern.daylight.shellkit.PlaylistWidgetState.Tap.*;
import static org.junit.Assert.assertEquals;

public class PlaylistWidgetStateTest {
    @Test public void aMatchingTapDoesTheActionShownByTheWidget() {
        assertEquals(START, new PlaylistWidgetState(READY, "").tap(""));
        assertEquals(START, new PlaylistWidgetState(FAILED, "retry").tap("retry"));
        assertEquals(IGNORE, new PlaylistWidgetState(STARTING, "starting").tap("starting"));
        assertEquals(PAUSE, new PlaylistWidgetState(PLAYING, "playing").tap("playing"));
        assertEquals(RESUME, new PlaylistWidgetState(PAUSED, "paused").tap("paused"));
    }

    @Test public void oldTapsCannotControlTheNextStateOrQueue() {
        assertEquals(IGNORE, new PlaylistWidgetState(PLAYING, "new-queue").tap("old-queue"));
        assertEquals(IGNORE, new PlaylistWidgetState(PAUSED, "paused").tap("playing"));
        assertEquals(IGNORE, new PlaylistWidgetState(PLAYING, "playing").tap(null));
        assertEquals(START, new PlaylistWidgetState(READY, "").tap(null));
    }

    @Test public void aStaleWidgetTapStartsPlaybackWhenNothingIsPlaying() {
        // The app was killed: the widget still shows "playing" with a revision this process never saw.
        assertEquals(START, new PlaylistWidgetState(READY, "fresh").tap("from-before-the-kill"));
        assertEquals(START, new PlaylistWidgetState(FAILED, "fresh").tap("from-before-the-kill"));
    }
}
