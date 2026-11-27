package net.kckern.daylight.cap.quickinput.shell;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Audit H15: "Sent" only when home has it; queued says it is saved and when it goes. */
public class CaptureOutcomeTest {
    @Test public void sentOnlyWhenHomeHasIt() {
        CaptureOutcome done = CaptureOutcome.of("DELIVERED", "Journal", true, false);
        assertEquals("Sent to Journal", done.line);
        assertTrue(done.sent);
        assertTrue(done.settled);
        assertEquals("Sent to Journal", CaptureOutcome.of("ACCEPTED", "Journal", false, false).line);
    }

    @Test public void queuedIsSavedAndSaysWhenItGoes() {
        assertEquals("Saved · sending to Journal…", CaptureOutcome.saving("Journal").line);
        CaptureOutcome waiting = CaptureOutcome.of("QUEUED", "Journal", true, false);
        assertEquals("Saved · sending to Journal…", waiting.line);
        assertFalse(waiting.settled);
        assertFalse(waiting.sent);
        assertEquals("Saved · sends when home answers", CaptureOutcome.of("QUEUED", "Journal", false, false).line);
        assertEquals("Saved · sends when home answers", CaptureOutcome.of(null, "Journal", true, true).line);
        assertEquals("Saved · sends when home answers", CaptureOutcome.of("RETRY", "Journal", true, true).line);
        assertEquals("Saved · still sending to Journal: see Capture status", CaptureOutcome.of("PROCESSING", "Journal", true, true).line);
    }

    @Test public void heldAndRefusedSayWhy() {
        assertEquals("Saved · sends when the daily allowance renews", CaptureOutcome.of("WAIT", "Meal photo", true, false).line);
        assertEquals("Saved · not accepted: see Capture status", CaptureOutcome.of("REJECTED", "Meal photo", true, false).line);
        assertEquals("Saved · sending…", CaptureOutcome.saving("").line);
    }
}
