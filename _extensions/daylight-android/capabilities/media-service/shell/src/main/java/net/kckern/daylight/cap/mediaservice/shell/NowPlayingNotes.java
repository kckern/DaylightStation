package net.kckern.daylight.cap.mediaservice.shell;

import android.os.SystemClock;

import androidx.media3.common.C;
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
        androidx.media3.common.MediaItem item = any ? p.getCurrentMediaItem() : null;
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
                }, false, "", item == null ? "" : item.mediaId);
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
    static String[] face(androidx.media3.common.MediaItem request) {
        if (request == null) return null;
        MediaMetadata m = request.mediaMetadata;
        String title = m.title == null ? "" : m.title.toString().trim();
        if (title.isEmpty()) return null;
        CharSequence by = m.artist != null ? m.artist : m.albumArtist;
        return new String[] { title, by == null ? "" : by.toString(), m.artworkUri == null ? "" : m.artworkUri.toString() };
    }
}
