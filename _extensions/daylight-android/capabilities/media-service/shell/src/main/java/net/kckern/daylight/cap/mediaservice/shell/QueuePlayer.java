package net.kckern.daylight.cap.mediaservice.shell;

import androidx.media3.common.C;
import androidx.media3.common.FlagSet;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * The session's player as controllers see it (this app's screens, the car, the lock
 * screen): every list change, shuffle and repeat goes to the queue (QueueController),
 * which makes the small change on the real player. Shuffle and Repeat All are the
 * queue's, not ExoPlayer's (ExoPlayer would shuffle your queued items and repeat the
 * history), so their state is answered here and their changes announced here.
 */
class QueuePlayer extends ForwardingPlayer {
    private final QueueController queue;
    private final List<Player.Listener> listeners = new CopyOnWriteArrayList<>();

    QueuePlayer(Player player, QueueController queue) {
        super(player);
        this.queue = queue;
        queue.onModes(this::announceModes);
    }

    @Override public void addListener(Player.Listener listener) {
        super.addListener(listener);
        listeners.add(listener);
    }

    @Override public void removeListener(Player.Listener listener) {
        super.removeListener(listener);
        listeners.remove(listener);
    }

    // ── a new source ────────────────────────────────────────────────────────

    @Override public void setMediaItem(MediaItem item) { setMediaItems(Collections.singletonList(item), 0, C.TIME_UNSET); }
    @Override public void setMediaItem(MediaItem item, long startPositionMs) { setMediaItems(Collections.singletonList(item), 0, startPositionMs); }
    @Override public void setMediaItem(MediaItem item, boolean resetPosition) { setMediaItems(Collections.singletonList(item), 0, C.TIME_UNSET); }
    @Override public void setMediaItems(List<MediaItem> items) { setMediaItems(items, 0, C.TIME_UNSET); }
    @Override public void setMediaItems(List<MediaItem> items, boolean resetPosition) { setMediaItems(items, 0, C.TIME_UNSET); }

    @Override public void setMediaItems(List<MediaItem> items, int startIndex, long startPositionMs) {
        clearStarting();
        queue.newSource(new ArrayList<>(items), startIndex == C.INDEX_UNSET ? 0 : startIndex, startPositionMs);
    }

    // ── edits from a controller (the car, another app) ─────────────────────

    @Override public void addMediaItem(MediaItem item) { addMediaItems(getMediaItemCount(), Collections.singletonList(item)); }
    @Override public void addMediaItem(int index, MediaItem item) { addMediaItems(index, Collections.singletonList(item)); }
    @Override public void addMediaItems(List<MediaItem> items) { addMediaItems(getMediaItemCount(), items); }

    /** Right after the item playing is Play next; anywhere else is Add to queue. */
    @Override public void addMediaItems(int index, List<MediaItem> items) {
        queue.addFromController(index, new ArrayList<>(items));
    }

    @Override public void removeMediaItem(int index) { removeMediaItems(index, index + 1); }
    @Override public void removeMediaItems(int fromIndex, int toIndex) { queue.removeFromController(fromIndex, toIndex); }
    @Override public void moveMediaItem(int currentIndex, int newIndex) { queue.move(currentIndex, newIndex, null); }
    @Override public void moveMediaItems(int fromIndex, int toIndex, int newIndex) {
        if (toIndex - fromIndex == 1) queue.move(fromIndex, newIndex, null);
    }
    @Override public void clearMediaItems() { queue.clearEverything(); }

    // ── shuffle and repeat ─────────────────────────────────────────────────

    @Override public boolean getShuffleModeEnabled() { return queue.model().shuffled(); }
    @Override public void setShuffleModeEnabled(boolean on) { queue.setShuffle(on); }

    @Override public int getRepeatMode() {
        switch (queue.model().repeat()) {
            case ALL: return Player.REPEAT_MODE_ALL;
            case ONE: return Player.REPEAT_MODE_ONE;
            default: return Player.REPEAT_MODE_OFF;
        }
    }

    @Override public void setRepeatMode(int mode) {
        queue.setRepeat(mode == Player.REPEAT_MODE_ALL ? QueueModel.Repeat.ALL
                : mode == Player.REPEAT_MODE_ONE ? QueueModel.Repeat.ONE : QueueModel.Repeat.OFF);
    }

    // A manual skip turns Repeat One back to the mode before it (spec §5).
    @Override public void seekToNext() { queue.manualSkip(); super.seekToNext(); }
    @Override public void seekToNextMediaItem() { queue.manualSkip(); super.seekToNextMediaItem(); }
    @Override public void seekToPrevious() { queue.manualSkip(); super.seekToPrevious(); }
    @Override public void seekToPreviousMediaItem() { queue.manualSkip(); super.seekToPreviousMediaItem(); }

    /** A queue kept after Stop or restored after a restart plays from where it is. */
    @Override public void play() {
        if (getPlaybackState() == Player.STATE_IDLE && getMediaItemCount() > 0) super.prepare();
        if (getPlaybackState() == Player.STATE_ENDED && getMediaItemCount() > 0) super.seekToDefaultPosition();
        super.play();
    }

    /** Tells every controller that shuffle or repeat changed (the real player's did not). */
    // ── a tapped item while it resolves (audit: the car's card showed the previous item) ──

    private volatile androidx.media3.common.MediaMetadata starting;

    /**
     * What the car, the notification and the lock screen show while a tapped item resolves:
     * its own title and cover, "Starting…" under it, the old item paused. Cleared by the new
     * source, or by {@link #clearStarting} when the start was refused. Main thread.
     */
    void showStarting(MediaItem tapped) {
        if (tapped == null) return;
        androidx.media3.common.MediaMetadata m = tapped.mediaMetadata;
        CharSequence by = m.artist != null ? m.artist : m.albumArtist;
        androidx.media3.common.MediaMetadata shown = m.buildUpon().setArtist(by == null ? "Starting…" : "Starting… · " + by).build();
        starting = shown;
        if (getPlayWhenReady()) super.pause();
        announceMetadata();
        // A start that neither played nor was refused within the play budget stops saying so.
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
            if (starting == shown) clearStarting();
        }, PlayBudget.giveUpMs(true));
    }

    void clearStarting() {
        if (starting == null) return;
        starting = null;
        announceMetadata();
    }

    @Override public androidx.media3.common.MediaMetadata getMediaMetadata() {
        androidx.media3.common.MediaMetadata s = starting;
        return s != null ? s : super.getMediaMetadata();
    }

    private void announceMetadata() {
        androidx.media3.common.MediaMetadata now = getMediaMetadata();
        Player.Events events = new Player.Events(new FlagSet.Builder().add(Player.EVENT_MEDIA_METADATA_CHANGED).build());
        for (Player.Listener l : listeners) {
            l.onMediaMetadataChanged(now);
            l.onEvents(this, events);
        }
    }

    private void announceModes() {
        boolean shuffle = getShuffleModeEnabled();
        int repeat = getRepeatMode();
        Player.Events events = new Player.Events(new FlagSet.Builder()
                .add(Player.EVENT_SHUFFLE_MODE_ENABLED_CHANGED).add(Player.EVENT_REPEAT_MODE_CHANGED).build());
        for (Player.Listener l : listeners) {
            l.onShuffleModeEnabledChanged(shuffle);
            l.onRepeatModeChanged(repeat);
            l.onEvents(this, events);
        }
    }
}
