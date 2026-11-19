package net.kckern.daylight.cap.webviewhost;

import static org.junit.Assert.*;

import org.junit.Test;

public class UnresponsiveTrackerTest {
    @Test public void terminatesOnlyAfterTheWholeLimitWithoutRecovery() {
        UnresponsiveTracker t = new UnresponsiveTracker();
        t.unresponsive(1_000);
        assertFalse(t.shouldTerminate(20_000, 30));
        t.unresponsive(25_000);
        assertTrue(t.shouldTerminate(31_000, 30));
    }

    @Test public void recoveryRestartsTheClock() {
        UnresponsiveTracker t = new UnresponsiveTracker();
        t.unresponsive(1_000);
        t.responsive();
        t.unresponsive(40_000);
        assertFalse(t.shouldTerminate(45_000, 30));
    }

    @Test public void zeroDisables() {
        UnresponsiveTracker t = new UnresponsiveTracker();
        t.unresponsive(0);
        assertFalse(t.shouldTerminate(999_999, 0));
        assertFalse(new UnresponsiveTracker().shouldTerminate(999_999, 30));
    }
}
