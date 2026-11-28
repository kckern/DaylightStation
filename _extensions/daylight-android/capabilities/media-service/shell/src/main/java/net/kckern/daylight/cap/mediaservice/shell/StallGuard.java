package net.kckern.daylight.cap.mediaservice.shell;

import androidx.media3.exoplayer.offline.Download;

/**
 * The decisions around a stall's remedy that keep it from fighting the person: a Pause is
 * never undone, a Remove is never undone by a re-add, and a stop of ours is never left behind.
 * Pure (the tick in {@link KeepStore} asks, then acts).
 */
final class StallGuard {
    private StallGuard() { }

    /** The stop reason a person's Pause sets (KeepStore.STOP_PAUSED). */
    static final int STOP_PAUSED = 1;

    enum Plan { CONTINUE, DROP, DROP_RESTORE }

    /**
     * What to do with an item's running fix this second.
     * @param holdingStop the fix has stopped the item's downloads and not resumed them yet
     */
    static Plan plan(boolean userPaused, boolean stillKept, boolean networkUsable, boolean holdingStop) {
        if (userPaused) return holdingStop ? Plan.DROP_RESTORE : Plan.DROP;
        if (!stillKept) return Plan.DROP;
        if (!networkUsable) return holdingStop ? Plan.DROP_RESTORE : Plan.DROP;
        return Plan.CONTINUE;
    }

    /** The stop reason to leave on a download the fix stopped: the person's Pause when they paused, else none. */
    static int restoreReason(boolean userPaused) {
        return userPaused ? STOP_PAUSED : Download.STOP_REASON_NONE;
    }

    /** Remove-and-add only for a download that is alive and whose item is still kept (never resurrects a removal). */
    static boolean readdAllowed(int downloadState, boolean stillKept) {
        if (!stillKept) return false;
        return downloadState == Download.STATE_DOWNLOADING || downloadState == Download.STATE_STOPPED
                || downloadState == Download.STATE_QUEUED;
    }
}
