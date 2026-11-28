package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;

/** Which browse nodes a change to the kept list makes stale (R4), and which a browser may subscribe to. */
public class KeptChangesTest {
    @Test public void aSavedKeepRefreshesTheKeptListAndTheRoot() {
        assertEquals(Arrays.asList("kept", "root"), KeptChanges.nodes(KeptChanges.SAVED));
    }

    @Test public void aReadyKeepRefreshesTheKeptListAndTheRoot() {
        assertEquals(Arrays.asList("kept", "root"), KeptChanges.nodes(KeptChanges.READY));
    }

    @Test public void aRemovedKeepRefreshesTheKeptListAndTheRoot() {
        assertEquals(Arrays.asList("kept", "root"), KeptChanges.nodes(KeptChanges.REMOVED));
    }

    @Test public void anUnknownChangeRefreshesNothing() {
        assertEquals(Collections.emptyList(), KeptChanges.nodes("renamed"));
        assertEquals(Collections.emptyList(), KeptChanges.nodes(null));
    }

    @Test public void theRootAndTheKeptListCanBeSubscribedTo() {
        assertTrue(KeptChanges.subscribable("root"));
        assertTrue(KeptChanges.subscribable("kept"));
    }

    @Test public void anyNamedFolderCanBeSubscribedToButNotNothing() {
        assertTrue(KeptChanges.subscribable("c:plex:594395"));
        assertFalse(KeptChanges.subscribable(""));
        assertFalse(KeptChanges.subscribable(null));
    }

    private static java.util.Set<String> set(String... ids) { return new java.util.HashSet<>(Arrays.asList(ids)); }

    @Test public void theFirstLookChangesNothing() {
        org.junit.Assert.assertNull(KeptChanges.change(null, null, set("a"), set("a")));
    }

    @Test public void aNewItemIsSavedAnItemGoneIsRemovedAnItemNowReadyIsReady() {
        assertEquals("saved", KeptChanges.change(set("a"), set("a"), set("a", "b"), set("a")));
        assertEquals("removed", KeptChanges.change(set("a", "b"), set("a"), set("a"), set("a")));
        assertEquals("ready", KeptChanges.change(set("a", "b"), set("a"), set("a", "b"), set("a", "b")));
    }

    @Test public void noDifferenceIsNoChange() {
        org.junit.Assert.assertNull(KeptChanges.change(set("a", "b"), set("a"), set("a", "b"), set("a")));
    }
}
