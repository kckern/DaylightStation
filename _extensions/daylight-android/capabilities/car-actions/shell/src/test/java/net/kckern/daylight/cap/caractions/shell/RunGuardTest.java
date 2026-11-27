package net.kckern.daylight.cap.caractions.shell;

import static org.junit.Assert.*;

import org.junit.Test;

public class RunGuardTest {
    @Test public void aSecondTapWhileRunningIsIgnored() {
        RunGuard g = new RunGuard(12_000);
        assertTrue(g.tryStart("garage-door", 1000));
        assertFalse("the door must not be toggled back", g.tryStart("garage-door", 1500));
        assertTrue(g.running("garage-door", 1500));
    }

    @Test public void theAnswerFreesTheAction() {
        RunGuard g = new RunGuard(12_000);
        assertTrue(g.tryStart("lights", 0));
        g.finish("lights");
        assertFalse(g.running("lights", 10));
        assertTrue(g.tryStart("lights", 10));
    }

    @Test public void theDeadlineFreesAnActionThatNeverAnswered() {
        RunGuard g = new RunGuard(12_000);
        assertTrue(g.tryStart("lights", 0));
        assertTrue(g.running("lights", 11_999));
        assertFalse(g.running("lights", 12_000));
        assertTrue(g.tryStart("lights", 12_001));
    }

    @Test public void otherActionsRunWhileOneIsRunning() {
        RunGuard g = new RunGuard(12_000);
        assertTrue(g.tryStart("lights", 0));
        assertTrue(g.tryStart("door", 100));
    }

    @Test public void anEntryWithNoIdNeverRuns() {
        RunGuard g = new RunGuard(12_000);
        assertFalse(g.tryStart("", 0));
        assertFalse(g.tryStart(null, 0));
    }

    @Test public void theSendingToastNamesTheAction() {
        assertEquals("Sending Lights off…", RunGuard.sending("Lights off"));
    }
}
