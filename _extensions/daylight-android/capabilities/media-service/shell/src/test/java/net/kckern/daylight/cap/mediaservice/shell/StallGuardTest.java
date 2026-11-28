package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import androidx.media3.exoplayer.offline.Download;

import org.junit.Test;

public class StallGuardTest {
    @Test public void aPausedItemDropsItsFixAndGetsItsPauseBackIfWeStoppedIt() {
        assertEquals(StallGuard.Plan.DROP_RESTORE, StallGuard.plan(true, true, true, true));
        assertEquals("nothing of ours is stopped", StallGuard.Plan.DROP, StallGuard.plan(true, true, true, false));
    }

    @Test public void anItemRemovedFromKeptDropsItsFix() {
        assertEquals(StallGuard.Plan.DROP, StallGuard.plan(false, false, true, true));
    }

    @Test public void anUnusableNetworkDropsTheFixAndRestoresWhatWeStopped() {
        assertEquals(StallGuard.Plan.DROP_RESTORE, StallGuard.plan(false, true, false, true));
        assertEquals(StallGuard.Plan.DROP, StallGuard.plan(false, true, false, false));
    }

    @Test public void otherwiseTheFixContinues() {
        assertEquals(StallGuard.Plan.CONTINUE, StallGuard.plan(false, true, true, true));
    }

    @Test public void aRestoreNeverResumesAPausedItem() {
        assertEquals(Download.STOP_REASON_NONE, StallGuard.restoreReason(false));
        assertEquals("the user's own pause", StallGuard.STOP_PAUSED, StallGuard.restoreReason(true));
    }

    @Test public void aReaddActsOnlyOnALiveDownloadOfAnItemStillKept() {
        assertTrue(StallGuard.readdAllowed(Download.STATE_DOWNLOADING, true));
        assertTrue(StallGuard.readdAllowed(Download.STATE_STOPPED, true));
        assertTrue(StallGuard.readdAllowed(Download.STATE_QUEUED, true));
        assertFalse("removed while it stalled", StallGuard.readdAllowed(Download.STATE_REMOVING, true));
        assertFalse(StallGuard.readdAllowed(Download.STATE_FAILED, true));
        assertFalse(StallGuard.readdAllowed(Download.STATE_COMPLETED, true));
        assertFalse("no download at all", StallGuard.readdAllowed(-1, true));
        assertFalse("no longer kept", StallGuard.readdAllowed(Download.STATE_DOWNLOADING, false));
    }

    @Test public void aRestartMergesTheKeysAlreadyStoppedWithTheOnesStillMoving() {
        java.util.List<String> merged = StallGuard.union(java.util.Arrays.asList("a", "b"), java.util.Arrays.asList("b", "c"));
        assertEquals(java.util.Arrays.asList("a", "b", "c"), merged);
        assertEquals(java.util.Arrays.asList("x"), StallGuard.union(java.util.Collections.<String>emptyList(), java.util.Arrays.asList("x")));
    }
}
