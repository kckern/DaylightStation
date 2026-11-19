package net.kckern.daylight.api;

import static org.junit.Assert.*;

import org.junit.Test;

public class KioskSlotTest {
    private static final class Controller implements KioskController {
        @Override public void onHostAttached(KioskHost host) { }
        @Override public void onHostDetached() { }
        @Override public void onHostVisible(boolean visible) { }
        @Override public void onHostResumed() { }
        @Override public void onHostPaused() { }
        @Override public void onHostWindowFocus(boolean focused) { }
        @Override public boolean onHostKey(Object keyEvent) { return false; }
        @Override public void onHostNewIntent(Object intent) { }
    }

    @Test public void aLateDetachByTheOldControllerLeavesTheNextOneAttached() {
        // The payload swap: the old session's stop() lands after the next session attached.
        KioskSlot slot = new KioskSlot();
        Controller old = new Controller(), next = new Controller();
        assertNull(slot.replace(old));
        assertSame("the old controller is the one to tell", old, slot.replace(next));

        assertFalse("the old payload must not detach the next payload's kiosk", slot.releaseIf(old));
        assertSame(next, slot.current());
    }

    @Test public void aControllerTakesItselfOut() {
        KioskSlot slot = new KioskSlot();
        Controller c = new Controller();
        slot.replace(c);
        assertTrue(slot.releaseIf(c));
        assertNull(slot.current());
        assertFalse("already gone", slot.releaseIf(c));
    }

    @Test public void nullNeverMatchesAnEmptySlot() {
        assertFalse(new KioskSlot().releaseIf(null));
    }

    @Test public void attachingTheAttachedControllerAgainChangesNothing() {
        // The same component can be reported twice (once when watched, once when published).
        KioskSlot slot = new KioskSlot();
        Controller c = new Controller();
        slot.replace(c);
        assertTrue(slot.holds(c));
        assertNull("nobody is to be told it was detached", slot.replace(c));
        assertSame(c, slot.current());
    }

    @Test public void clearEmptiesWhateverIsThere() {
        KioskSlot slot = new KioskSlot();
        Controller c = new Controller();
        slot.replace(c);
        assertSame(c, slot.clear());
        assertNull(slot.current());
        assertNull(slot.clear());
    }

    @Test public void aFailedControllerIsTriedAgainWithAGrowingWaitUpToAMinute() {
        assertEquals(2_000, KioskSlot.retryDelayMs(1));
        assertEquals(4_000, KioskSlot.retryDelayMs(2));
        assertEquals(8_000, KioskSlot.retryDelayMs(3));
        assertEquals(60_000, KioskSlot.retryDelayMs(6));
        assertEquals(60_000, KioskSlot.retryDelayMs(500));
        assertEquals(2_000, KioskSlot.retryDelayMs(0));
    }
}
