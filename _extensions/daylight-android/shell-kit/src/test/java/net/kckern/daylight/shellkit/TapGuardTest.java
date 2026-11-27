package net.kckern.daylight.shellkit;

import static org.junit.Assert.*;

import org.junit.Test;

public class TapGuardTest {
    @Test public void aDoubleTapOnTheSameItemStartsItOnce() {
        TapGuard g = new TapGuard();
        assertTrue(g.admit("c:plex:1", 10_000));
        g.done();
        assertFalse(g.admit("c:plex:1", 10_300));
        assertTrue("after the window it plays again", g.admit("c:plex:1", 11_000));
    }

    @Test public void aRepeatWhileTheStartIsInFlightIsDroppedPastTheWindow() {
        TapGuard g = new TapGuard();
        assertTrue(g.admit("c:plex:1", 0));
        assertFalse("the player is still connecting", g.admit("c:plex:1", 5_000));
        g.done();
        assertTrue(g.admit("c:plex:1", 5_001));
    }

    @Test public void anotherItemAlwaysGoesThrough() {
        TapGuard g = new TapGuard();
        assertTrue(g.admit("c:plex:1", 0));
        assertTrue(g.admit("c:plex:2", 100));
        assertTrue("back to the first: a new choice, not a repeat", g.admit("c:plex:1", 200));
    }

    @Test public void aMissingIdIsOneItem() {
        TapGuard g = new TapGuard();
        assertTrue(g.admit(null, 0));
        assertFalse(g.admit("", 10));
    }
}
