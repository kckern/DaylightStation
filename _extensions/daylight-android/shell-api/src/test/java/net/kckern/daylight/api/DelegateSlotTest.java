package net.kckern.daylight.api;

import static org.junit.Assert.*;

import org.junit.Test;

public class DelegateSlotTest {
    @Test public void clearEmptiesTheSlotOnlyForTheDelegateItHolds() {
        DelegateSlot<String> slot = new DelegateSlot<>();
        assertNull(slot.get());
        slot.set("old payload");
        slot.set("new payload");
        assertFalse("the old payload's late detach", slot.clear("old payload"));
        assertEquals("new payload", slot.get());
        assertTrue(slot.clear("new payload"));
        assertNull(slot.get());
        assertFalse(slot.clear("new payload"));
    }
}
