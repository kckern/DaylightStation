package net.kckern.daylight.cap.webviewhost;

import static org.junit.Assert.*;

import org.junit.Test;

public class RendererLossPolicyTest {
    @Test public void theFirstLossIsRebuiltAtOnce() {
        RendererLossPolicy p = new RendererLossPolicy();
        RendererLossPolicy.Action a = p.lost(1_000, 30, 300);
        assertEquals(1, a.count);
        assertEquals(0, a.delayMs);
        assertFalse(a.showErrorPage);
    }

    @Test public void aPageThatCrashesItsRendererEveryTimeItLoadsIsSlowedDown() {
        // The loop: load, crash a few seconds later, rebuild, load, crash. A load that
        // succeeded in between does not clear the count: nothing here hears about loads.
        RendererLossPolicy p = new RendererLossPolicy();
        assertEquals(0, p.lost(0, 30, 300).delayMs);
        RendererLossPolicy.Action second = p.lost(8_000, 30, 300);
        assertEquals(2, second.count);
        assertEquals(30_000, second.delayMs);
        assertTrue(second.showErrorPage);
        RendererLossPolicy.Action third = p.lost(46_000, 30, 300);
        assertEquals(RendererLossPolicy.GIVE_UP_AFTER, third.count);
        assertEquals("the slow schedule", 300_000, third.delayMs);
        assertTrue(third.showErrorPage);
        // Reloaded at 346 s, crashed again 8 s later. More than five minutes after the last
        // loss, and still the same loop: the renderer lived 8 s.
        RendererLossPolicy.Action fourth = p.lost(354_000, 30, 300);
        assertEquals(4, fourth.count);
        assertEquals(300_000, fourth.delayMs);
        assertEquals(4, p.total());
    }

    @Test public void aRendererThatOutlivesTheWindowStartsANewCount() {
        RendererLossPolicy p = new RendererLossPolicy();
        p.lost(0, 30, 300);
        p.lost(10_000, 30, 300);
        assertEquals(2, p.consecutive(20_000));
        long later = 10_000 + 30_000 + RendererLossPolicy.WINDOW_MS + 1;   // reloaded at 40 s, alive past the window
        assertEquals(0, p.consecutive(later));
        RendererLossPolicy.Action a = p.lost(later, 30, 300);
        assertEquals(1, a.count);
        assertEquals(0, a.delayMs);
        assertEquals("the total is never cleared", 3, p.total());
    }

    @Test public void aLoopIsSlowedEvenWherePageRetriesAreSwitchedOff() {
        RendererLossPolicy p = new RendererLossPolicy();
        p.lost(0, 0, 0);
        assertTrue(p.lost(1_000, 0, 0).delayMs >= 1_000);
        assertTrue(p.lost(3_000, 0, 0).delayMs >= 1_000);
    }
}
