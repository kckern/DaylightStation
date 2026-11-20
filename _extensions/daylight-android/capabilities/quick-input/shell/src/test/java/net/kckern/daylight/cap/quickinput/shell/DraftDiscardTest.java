package net.kckern.daylight.cap.quickinput.shell;

import org.junit.Test;

import static org.junit.Assert.*;

public class DraftDiscardTest {
    @Test public void staleConfirmationCannotDeleteRetargetedDraftOrOriginalOnReturn() {
        DraftDiscard gate = new DraftDiscard();
        DraftDiscard.Request first = gate.ask("first");
        gate.invalidate();
        assertFalse(gate.confirm(first, "second"));
        assertFalse(gate.confirm(first, "first"));
        DraftDiscard.Request second = gate.ask("second");
        assertFalse(gate.confirm(second, "first"));
        assertTrue(gate.confirm(second, "second"));
        assertFalse(gate.confirm(second, "second"));
    }
}
