package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** A burst of keeps (a group of N units) runs one refresh, not N. */
public class RefreshGateTest {
    @Test public void onlyTheFirstAskInABurstArms() {
        RefreshGate gate = new RefreshGate();
        assertTrue(gate.arm());
        assertFalse(gate.arm());
        assertFalse(gate.arm());
    }

    @Test public void onceTheRefreshRunsTheNextAskArmsAgain() {
        RefreshGate gate = new RefreshGate();
        assertTrue(gate.arm());
        gate.fired();
        assertTrue(gate.arm());
    }
}
