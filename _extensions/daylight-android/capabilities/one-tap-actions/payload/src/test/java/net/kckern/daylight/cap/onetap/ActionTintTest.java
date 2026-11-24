package net.kckern.daylight.cap.onetap;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class ActionTintTest {
    @Test public void aKindOfActionKeepsOneColour() {
        assertEquals(ActionTint.JOURNAL, ActionTint.of("notebook"));
        assertEquals(ActionTint.MEAL, ActionTint.of("fork"));
        assertEquals(ActionTint.MEAL, ActionTint.of("barcode"));
        assertEquals(ActionTint.HEALTH, ActionTint.of("health"));
    }

    @Test public void anUnknownIconKeepsTheAppGreen() {
        assertEquals(ActionTint.GREEN, ActionTint.of("lifelog"));
        assertEquals(ActionTint.GREEN, ActionTint.of(null));
    }
}
