package net.kckern.daylight.cap.mediaservice.shell;

import net.kckern.daylight.shellkit.AndroidPackageFacts;

import android.app.PendingIntent;
import android.content.Intent;
import android.util.Log;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import java.util.Collections;
import java.util.List;

import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaLibraryService;
import androidx.media3.session.MediaSession;

import net.kckern.daylight.shellkit.ShellStart;
import net.kckern.daylight.shellkit.SurfaceCache;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The installed half of native playback. Android creates it by class name when a
 * car, the system's media controls or a headset button binds it, which can happen in
 * a process with no payload. It owns only what Media3 needs in the installed package
 * (the player, the session, the media notification, the foreground state) and asks
 * the payload for everything else through PayloadMedia.
 *
 * Rule for editing this file: host, do not decide. What may be browsed, what an id
 * plays and when progress is reported are the payload's; who may connect is
 * ControllerPolicy's.
 *
 * Cold start: onCreate asks for the shell service, which loads the payload. Android
 * may refuse that from the background; the callbacks then answer with their fallback
 * (LibraryCallback) and nothing here throws.
 */
public class DaylightMediaService extends MediaLibraryService {
    private static final String TAG = "Daylight-Media";

    // The non-exported start service and this Media3 service share the app process and main looper.
    private static DaylightMediaService current;

    private ExoPlayer player;
    private PayloadMedia media;
    private PlayStart.Attempt shortcutOwner;
    private MediaLibrarySession session;
    private PlaybackEvents events;
    private ExecutorService io;

    @Override
    public void onCreate() {
        super.onCreate();
        ShellStart.ensure(this);
        io = Executors.newFixedThreadPool(2, r -> {
            Thread t = new Thread(r, "Daylight-media-io");
            t.setDaemon(true);
            return t;
        });
        media = new PayloadMedia();

        // Audio focus and "headphones unplugged" are the player's: it pauses for a call,
        // ducks for a prompt and stops when the output goes away. The wake mode holds the
        // CPU and the network while playing with the screen off.
        player = new ExoPlayer.Builder(this)
                .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
                .setHandleAudioBecomingNoisy(true)
                .setWakeMode(C.WAKE_MODE_NETWORK)
                .build();

        player.addListener(new Player.Listener() {
            @Override public void onIsPlayingChanged(boolean playing) {
                PlayStart.Attempt attempt = shortcutOwner;
                if (playing && attempt != null && ownsPlaylist(attempt)) {
                    attempt.recordPlaying(SystemClock.elapsedRealtime());
                }
            }
        });

        MediaLibrarySession.Builder builder = new MediaLibrarySession.Builder(this, player,
                new LibraryCallback(media, io, getPackageName(), new AndroidPackageFacts(getPackageManager()),
                        () -> SurfaceCache.get(this, ControllerPins.KEY), DaylightMediaService::stopPlayback));
        builder.setCustomLayout(Collections.singletonList(LibraryCallback.stopButton()));
        // A tap on the media notification opens this app's own window. Nothing from a
        // controller is in the intent.
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (open != null) {
            builder.setSessionActivity(PendingIntent.getActivity(this, 0, open,
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        }
        session = builder.build();

        setListener(new Listener() {
            @Override public void onForegroundServiceStartNotAllowedException() {
                foreground = false;
                Log.w(TAG, "Android refused the media service's foreground start");
            }
        });

        events = new PlaybackEvents(player, media, io);
        events.attach();
        current = this;
        Log.i(TAG, "media service created");
    }

    /**
     * Resolve through the same payload as car and phone browsing. The attempt is checked on the
     * player's thread before changing anything, so a late lookup cannot prepare or play a queue.
     */
    static void playShortcut(PlayStart.Attempt attempt, String mediaId, Runnable failed) {
        DaylightMediaService service = current;
        if (service == null) { failed.run(); return; }
        service.io.execute(() -> {
            TrackAnswer tracks;
            try {
                tracks = service.media.resolveShortcut(mediaId, 8000);
            } catch (Exception failure) {
                tracks = null;
            }
            TrackAnswer answer = tracks;
            new Handler(Looper.getMainLooper()).post(() -> {
                if (current != service || !attempt.canApply(SystemClock.elapsedRealtime())) return;
                if (answer == null) { failed.run(); return; }
                try {
                    List<MediaItem> items = NodeItems.tracks(answer.tracks);
                    items.set(0, items.get(0).buildUpon().setTag(attempt).build());
                    service.shortcutOwner = attempt;
                    ExoPlayer player = service.player;
                    player.pause();
                    player.setMediaItems(items, answer.startIndex, answer.startPositionMs > 0
                            ? answer.startPositionMs : C.TIME_UNSET);
                    player.prepare();
                    player.play();
                } catch (RuntimeException failure) {
                    failed.run();
                }
            });
        });
    }

    static void stopPlayback() {
        PlayActionService.cancelCurrentStart();
        DaylightMediaService service = current;
        if (service != null) service.stopPlayer();
    }

    private void stopPlayer() {
        player.pause();
        player.stop();
        player.clearMediaItems();
        shortcutOwner = null;
    }

    private boolean ownsPlaylist(PlayStart.Attempt attempt) {
        if (shortcutOwner != attempt || player.getMediaItemCount() == 0) return false;
        MediaItem.LocalConfiguration first = player.getMediaItemAt(0).localConfiguration;
        return first != null && first.tag == attempt;
    }

    static boolean shortcutPlaying(PlayStart.Attempt attempt) {
        DaylightMediaService service = current;
        return service != null && service.ownsPlaylist(attempt) && service.player.isPlaying();
    }

    static boolean shortcutFailed(PlayStart.Attempt attempt) {
        DaylightMediaService service = current;
        return service != null && service.ownsPlaylist(attempt) && service.player.getPlayerError() != null;
    }

    static void stopShortcut(PlayStart.Attempt attempt) {
        DaylightMediaService service = current;
        if (service != null && service.ownsPlaylist(attempt)) {
            service.stopPlayer();
        }
    }

    /** Whether the media service holds the foreground state now. Read by PlayActionService, in process. */
    private static volatile boolean foreground;

    static boolean inForeground() { return foreground; }

    /**
     * Media3 1.1.1 moves this service into the foreground when the player starts, by
     * calling startForegroundService on itself. From Android 12 that start can be refused
     * while the app is in the background. Media3 catches the refusal itself (read from its
     * bytecode: MediaSessionService.onUpdateNotificationInternal) and tells the Listener
     * set in onCreate, which clears the flag. A play service started by a tap keeps its
     * own foreground state while the audio plays when the flag is false (PlayStart).
     */
    @Override
    public void onUpdateNotification(MediaSession session, boolean startInForegroundRequired) {
        foreground = startInForegroundRequired;
        super.onUpdateNotification(session, startInForegroundRequired);
    }

    @Override
    public MediaLibrarySession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return session;
    }

    /** The app was swiped away: keep playing if something is playing, otherwise go. */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        ExoPlayer p = player;
        if (p == null || !p.getPlayWhenReady() || p.getMediaItemCount() == 0) stopSelf();
    }

    @Override
    public void onDestroy() {
        if (current == this) current = null;
        clearListener();
        if (events != null) { events.detach(); events = null; }
        if (session != null) { session.release(); session = null; }
        if (player != null) { player.release(); player = null; }
        if (io != null) { io.shutdown(); io = null; }
        foreground = false;
        Log.i(TAG, "media service destroyed");
        super.onDestroy();
    }
}
