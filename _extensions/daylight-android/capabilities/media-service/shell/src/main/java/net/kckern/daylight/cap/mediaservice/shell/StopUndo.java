package net.kckern.daylight.cap.mediaservice.shell;

/**
 * What Stop and clear took (R5): the queue as it was, where the item was and whether it was
 * playing. Good for {@link #WINDOW_MS} and only while nothing else has changed the queue
 * (a new play, an add): the model's revision after the clear must still be current.
 */
final class StopUndo<T> {
    /** A little longer than the 6 s snackbar, so a tap at its last moment still lands. */
    static final long WINDOW_MS = net.kckern.daylight.shellkit.NowPlayingNote.UNDO_SNACK_MS + 2000;

    final QueueModel.QueueSnapshot<T> snapshot;
    final long positionMs, clearedAt;
    final boolean wasPlaying;
    final int revAfter;

    StopUndo(QueueModel.QueueSnapshot<T> snapshot, long positionMs, boolean wasPlaying, long clearedAt, int revAfter) {
        this.snapshot = snapshot;
        this.positionMs = positionMs;
        this.wasPlaying = wasPlaying;
        this.clearedAt = clearedAt;
        this.revAfter = revAfter;
    }

    boolean live(long now, int currentRev) {
        return now - clearedAt < WINDOW_MS && currentRev == revAfter;
    }
}
