package net.kckern.daylight.shellkit;

import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** In-process playback state. A fresh process renders Play until it owns a queue again. */
public final class PlaylistWidgetState {
    public static final String CHANGED = "net.kckern.daylight.PLAYLIST_WIDGET_CHANGED";
    public static final String PROGRESS_CHANGED = CHANGED + ".PROGRESS";
    private static final String PROVIDER = "net.kckern.daylight.cap.widgets.shell.ButtonWidgetProvider";
    public enum Phase { READY, STARTING, PLAYING, PAUSED, FAILED }
    public enum Tap { START, PAUSE, RESUME, IGNORE }

    private static final Map<String, PlaylistWidgetState> current = new HashMap<>();
    private static final PlaylistWidgetState READY = new PlaylistWidgetState(Phase.READY, "");

    public static final class Progress {
        public final long positionMs;
        public final long durationMs;
        public final int trackNumber;
        public final int trackCount;

        public Progress(long positionMs, long durationMs, int trackNumber, int trackCount) {
            this.positionMs = positionMs;
            this.durationMs = durationMs;
            this.trackNumber = trackNumber;
            this.trackCount = trackCount;
        }
    }

    private static String progressPlaylist;
    private static Progress progress;
    private static String artworkPlaylist;
    private static Bitmap artwork;

    public final Phase phase;
    public final String revision;

    PlaylistWidgetState(Phase phase, String revision) {
        this.phase = phase;
        this.revision = revision;
    }

    public static PlaylistWidgetState get(String playlist) {
        return current.getOrDefault(playlist, READY);
    }

    public static void show(Context context, String playlist, Phase phase) {
        if (playlist == null || get(playlist).phase == phase) return;
        if (phase == Phase.READY) current.remove(playlist);
        else current.put(playlist, new PlaylistWidgetState(phase, UUID.randomUUID().toString()));
        redraw(context);
    }

    public static Progress progress(String playlist) {
        return playlist.equals(progressPlaylist) ? progress : null;
    }

    public static void progress(Context context, String playlist, Progress snapshot) {
        progressPlaylist = playlist;
        progress = snapshot;
        if (snapshot != null) context.sendBroadcast(new Intent(PROGRESS_CHANGED).setClassName(context, PROVIDER));
    }

    public static Bitmap trackArtwork(String playlist) {
        return playlist.equals(artworkPlaylist) ? artwork : null;
    }

    public static void trackArtwork(Context context, String playlist, Bitmap bitmap) {
        if (java.util.Objects.equals(playlist, artworkPlaylist) && bitmap == artwork) return;
        artworkPlaylist = playlist;
        artwork = bitmap;
        redraw(context);
    }

    public static void redraw(Context context) {
        context.sendBroadcast(new Intent(CHANGED).setClassName(context, PROVIDER));
    }

    public Tap tap(String expectedRevision) {
        if (expectedRevision == null) return phase == Phase.READY ? Tap.START : Tap.IGNORE;
        if (!revision.equals(expectedRevision)) {
            // The widget on Home is older than this process: after the app was killed it keeps showing
            // "playing" with a revision nothing here knows. If nothing is playing now, the owner's tap
            // means "play this", so start it instead of swallowing the first tap.
            return phase == Phase.READY || phase == Phase.FAILED ? Tap.START : Tap.IGNORE;
        }
        switch (phase) {
            case PLAYING: return Tap.PAUSE;
            case PAUSED: return Tap.RESUME;
            case READY:
            case FAILED: return Tap.START;
            default: return Tap.IGNORE;
        }
    }
}
