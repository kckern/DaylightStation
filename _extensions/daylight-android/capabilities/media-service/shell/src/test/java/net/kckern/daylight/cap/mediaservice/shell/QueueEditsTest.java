package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Arrays;

/**
 * A controller's removal is masked at once on its own copy of the timeline; if the queue does
 * not do exactly what was asked (the playing item is never removed this way), the controller's
 * copy is wrong until the session sends its timeline again. These say when that is the case.
 */
public class QueueEditsTest {
    @Test public void theItemPlayingIsLeftOutOfARemoval() {
        assertEquals(Arrays.asList(3, 1, 0), QueueEdits.removable(0, 4, 2));
        assertEquals(Arrays.asList(4, 3), QueueEdits.removable(3, 5, 9));
    }

    @Test public void aRemovalThatIncludesTheItemPlayingIsNotExact() {
        assertFalse(QueueEdits.exact(0, 4, 2));
        assertTrue(QueueEdits.exact(0, 2, 2));
        assertTrue(QueueEdits.exact(3, 5, 2));
    }
}
