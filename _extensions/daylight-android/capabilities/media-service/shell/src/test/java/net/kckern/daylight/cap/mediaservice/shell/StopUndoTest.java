package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** The undo of Stop and clear (R5): good for a short window, and only while nothing else changed the queue. */
public class StopUndoTest {
    private StopUndo<String> at(long clearedAt, int revAfter) {
        return new StopUndo<>(null, 12_000, true, clearedAt, revAfter);
    }

    @Test public void liveWithinTheWindowWhenTheQueueIsUntouched() {
        assertTrue(at(1000, 7).live(1000 + StopUndo.WINDOW_MS - 1, 7));
    }

    @Test public void expiresWhenTheWindowPasses() {
        assertFalse(at(1000, 7).live(1000 + StopUndo.WINDOW_MS, 7));
    }

    @Test public void deadOnceAnythingChangedTheQueue() {
        assertFalse(at(1000, 7).live(2000, 8));
    }

    @Test public void theWindowOutlastsTheSixSecondSnackbar() {
        assertTrue(StopUndo.WINDOW_MS > 6000);
    }
}
