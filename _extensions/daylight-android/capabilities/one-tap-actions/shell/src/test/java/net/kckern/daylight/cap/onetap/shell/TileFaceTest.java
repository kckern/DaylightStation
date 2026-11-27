package net.kckern.daylight.cap.onetap.shell;

import static org.junit.Assert.*;

import org.junit.Test;

public class TileFaceTest {
    @Test public void anAssignedSlotShowsItsActionAndCanBeTapped() {
        TileFace f = TileFace.of(1, "New memo", "mic", "daylight://action/memo#k=abc");
        assertEquals("New memo", f.label);
        assertEquals("ic_action_mic", f.iconName);
        assertTrue(f.available);
        assertEquals("daylight://action/memo#k=abc", f.link);
    }

    @Test public void anUnassignedSlotSaysWhichSlotItIsAndCannotBeTapped() {
        TileFace f = TileFace.of(3, "", "", "");
        assertEquals("Action 3", f.label);
        assertFalse(f.available);
        assertEquals("", f.link);
        assertFalse("a stale label with no link is not shown as an action", TileFace.of(2, "Old", "mic", "").available);
        assertEquals("Action 2", TileFace.of(2, "Old", "mic", "").label);
    }

    @Test public void anAssignedSlotWithNoLabelOrIconStillWorks() {
        TileFace f = TileFace.of(4, "", "", "daylight://action/x");
        assertEquals("Action 4", f.label);
        assertEquals("ic_action_open", f.iconName);
        assertTrue(f.available);
    }

    @Test public void anIconNameThatIsNotAPlainNameFallsBackToTheDefault() {
        assertEquals("ic_action_open", TileFace.of(1, "X", "../../x", "daylight://action/x").iconName);
        assertEquals("ic_action_open", TileFace.of(1, "X", "Mic Icon", "daylight://action/x").iconName);
    }
}
