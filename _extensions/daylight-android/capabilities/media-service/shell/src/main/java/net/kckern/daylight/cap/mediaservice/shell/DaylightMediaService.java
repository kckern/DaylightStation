package net.kckern.daylight.cap.mediaservice.shell;

import android.app.PendingIntent;
import android.content.Intent;
import android.util.Log;

import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
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

    private ExoPlayer player;
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
        PayloadMedia media = new PayloadMedia();

        // Audio focus and "headphones unplugged" are the player's: it pauses for a call,
        // ducks for a prompt and stops when the output goes away. The wake mode holds the
        // CPU and the network while playing with the screen off.
        player = new ExoPlayer.Builder(this)
                .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
                .setHandleAudioBecomingNoisy(true)
                .setWakeMode(C.WAKE_MODE_NETWORK)
                .build();

        MediaLibrarySession.Builder builder = new MediaLibrarySession.Builder(this, player,
                new LibraryCallback(media, io, getPackageName(), new AndroidPackageFacts(getPackageManager()),
                        () -> SurfaceCache.get(this, ControllerPins.KEY)));
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
        Log.i(TAG, "media service created");
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
        super.onUpdateNotification(session, startInForegroundRequired);
        foreground = startInForegroundRequired;
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
