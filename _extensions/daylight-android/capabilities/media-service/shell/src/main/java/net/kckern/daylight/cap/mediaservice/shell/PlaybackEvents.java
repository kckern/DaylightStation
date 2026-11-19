package net.kckern.daylight.cap.mediaservice.shell;

import android.os.Handler;
import android.os.Looper;

import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;

import com.google.common.util.concurrent.MoreExecutors;

import java.util.concurrent.Executor;

/**
 * Sends the player's position to the payload: on every transition and every five
 * seconds while playing. Whether an event becomes a progress report is the
 * payload's decision (its ProgressReporter).
 */
final class PlaybackEvents implements Player.Listener {
    private static final long TICK_MS = 5000;

    private final Player player;
    private final PayloadMedia media;
    private final Executor io;
    private Player.PositionInfo outgoing;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            send("playing");
            main.postDelayed(this, TICK_MS);
        }
    };

    PlaybackEvents(Player player, PayloadMedia media, Executor io) {
        this.player = player;
        this.media = media;
        // The service shares a pool with browse requests. Preserve playback event order.
        this.io = MoreExecutors.newSequentialExecutor(io);
    }

    void attach() { player.addListener(this); }

    void detach() {
        main.removeCallbacks(tick);
        player.removeListener(this);
    }

    @Override public void onIsPlayingChanged(boolean isPlaying) {
        main.removeCallbacks(tick);
        if (isPlaying) {
            send("playing");
            main.postDelayed(tick, TICK_MS);
        } else if (player.getPlaybackState() != Player.STATE_ENDED) {
            send("paused");
        }
    }

    @Override public void onPlaybackStateChanged(int state) {
        if (state == Player.STATE_ENDED) send("ended");
    }

    @Override public void onPositionDiscontinuity(Player.PositionInfo oldPosition,
                                                  Player.PositionInfo newPosition, int reason) {
        outgoing = reason == Player.DISCONTINUITY_REASON_AUTO_TRANSITION ? oldPosition : null;
    }

    @Override public void onMediaItemTransition(MediaItem item, int reason) {
        if (outgoing != null && (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO
                || reason == Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT)) {
            // Media3 supplies the old item's end position even if we never sampled it.
            long end = outgoing.contentPositionMs;
            send(outgoing.mediaItem, end, end, "ended");
        }
        outgoing = null;
        if (item != null) send(player.isPlaying() ? "playing" : "paused");
    }

    /** Called on the main thread; the call to the payload runs on the io executor. */
    private void send(final String state) {
        send(player.getCurrentMediaItem(), player.getCurrentPosition(), player.getDuration(), state);
    }

    private void send(MediaItem current, long position, long duration, String state) {
        if (current == null) return;
        final String id = current.mediaId;
        final String title = current.mediaMetadata.title == null ? "" : current.mediaMetadata.title.toString();
        final String listId = current.mediaMetadata.extras == null ? "" : current.mediaMetadata.extras.getString(NodeItems.EXTRA_LIST_ID, "");
        try {
            io.execute(() -> media.event(id, title, listId, position, duration == C.TIME_UNSET ? 0 : duration, state));
        } catch (RuntimeException stopping) {
            // The service is going away; progress is advisory.
        }
    }
}
