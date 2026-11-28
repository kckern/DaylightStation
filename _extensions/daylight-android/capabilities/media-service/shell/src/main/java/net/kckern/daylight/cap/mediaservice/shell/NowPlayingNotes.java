package net.kckern.daylight.cap.mediaservice.shell;

import android.os.SystemClock;

import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;

import net.kckern.daylight.shellkit.NowPlayingNote;

/** A player's state as the phone home's mini player needs it, with buttons that act on that player. */
final class NowPlayingNotes {
    private NowPlayingNotes() { }

    static NowPlayingNote.Entry entry(String target, String targetName, Player p) {
        boolean any = p.getMediaItemCount() > 0;
        MediaMetadata m = any ? p.getMediaMetadata() : MediaMetadata.EMPTY;
        boolean playing = p.getPlayWhenReady()
                && (p.getPlaybackState() == Player.STATE_READY || p.getPlaybackState() == Player.STATE_BUFFERING);
        long duration = p.getDuration();
        // A screen's player names the screen as its artist; the strip says where on its own.
        String artist = "local".equals(target) && m.artist != null ? m.artist.toString() : "";
        MediaItem item = any ? p.getCurrentMediaItem() : null;
        return new NowPlayingNote.Entry(target, targetName,
                m.title == null ? "" : m.title.toString(), artist,
                m.artworkUri == null ? "" : m.artworkUri.toString(),
                playing, p.isCommandAvailable(Player.COMMAND_SEEK_TO_NEXT) && p.hasNextMediaItem(),
                Math.max(0, p.getCurrentPosition()), duration == C.TIME_UNSET ? -1 : duration,
                SystemClock.elapsedRealtime(), new NowPlayingNote.Transport() {
                    @Override public void playPause() {
                        if (p.getPlayWhenReady() && p.getPlaybackState() != Player.STATE_ENDED) { p.pause(); return; }
                        if (p.getPlaybackState() == Player.STATE_IDLE) p.prepare();
                        p.play();
                    }
                    @Override public void next() { if (p.hasNextMediaItem()) p.seekToNext(); }

                    @Override public Object stopAndClear() {
                        if ("local".equals(target)) {
                            QueueController q = QueueController.live();
                            Object undo = q == null ? null : q.stopAndClear();
                            if (undo != null) return undo;
                            // No controller, or its model is empty while the player still holds something
                            // (the bar must never stay up after Stop and clear): the player's own stop and clear.
                            p.stop();
                            p.clearMediaItems();
                            return NowPlayingNote.NO_UNDO;
                        }
                        // A screen: its own stop; what it held is the screen's to keep, so there is no Undo.
                        p.stop();
                        return NowPlayingNote.NO_UNDO;
                    }

                    @SuppressWarnings("unchecked")
                    @Override public boolean restore(Object token) {
                        QueueController q = QueueController.live();
                        return q != null && token instanceof StopUndo && q.restoreStopped((StopUndo<MediaItem>) token);
                    }
                }, false, "", item == null ? "" : item.mediaId,
                item == null ? "" : listOf(NodeItems.listId(item), item.localConfiguration == null ? null : item.localConfiguration.tag));
    }

    /**
     * The list an item plays from: its own list id, else, for the start item of a tapped list,
     * the list asked for (its QueueTag, in this process only). "" for none.
     */
    static String listOf(String listId, Object tag) {
        if (listId != null && !listId.isEmpty()) return listId;
        if (!(tag instanceof QueueTag)) return "";
        String asked = ((QueueTag) tag).sourceId;
        return asked.startsWith("c:") ? asked : "";
    }

    /**
     * A start on this phone from a path with no Now playing over it (a widget or a tile, the
     * car, Play next on an empty queue): the mini player shows the tapped item at once,
     * "Starting…", never the previous one (NowPlayingNote.starting holds the player's reports
     * of it). {@code mediaId} is the tapped id ("" when not known yet); {@code face} is title, by-line and cover, or null when only the tap is known.
     */
    static void starting(String mediaId, String[] face) {
        String[] f = face == null ? new String[] { "", "", "" } : face;
        NowPlayingNote.starting("local", "This phone", f[0], f[1], f[2], SystemClock.elapsedRealtime(), mediaId);
    }

    /** What a play request shows of itself (title, artist or album artist, cover); null when it has no title. */
    static String[] face(MediaItem request) {
        if (request == null) return null;
        MediaMetadata m = request.mediaMetadata;
        String title = m.title == null ? "" : m.title.toString().trim();
        if (title.isEmpty()) return null;
        CharSequence by = m.artist != null ? m.artist : m.albumArtist;
        return new String[] { title, by == null ? "" : by.toString(), m.artworkUri == null ? "" : m.artworkUri.toString() };
    }
}
