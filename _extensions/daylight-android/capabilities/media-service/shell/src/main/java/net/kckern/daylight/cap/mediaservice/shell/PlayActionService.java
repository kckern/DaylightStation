package net.kckern.daylight.cap.mediaservice.shell;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.widget.Toast;

import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;

import com.google.common.util.concurrent.ListenableFuture;

import net.kckern.daylight.api.DirectPlay;
import net.kckern.daylight.shellkit.ShellStart;

/**
 * Plays a media action with no window: a tap on a widget button or a tile starts this
 * service in the foreground (PendingIntent.getForegroundService, or startForegroundService
 * from a tile), and it plays the action through a MediaController, as PlayActivity does
 * for a keyed media link, without bringing the app to the front.
 *
 * Not exported: only this app's own PendingIntents and tiles reach it. It reads one
 * thing from its intent, an action id (DirectPlay.actionFrom), and never content. The
 * payload turns the id into the content of a configured or pinned action, or refuses;
 * then the media service resolves that through the backend as for any controller. So
 * nothing plays that the owner did not set up, and nothing the backend did not answer.
 *
 * It calls startForeground at once (Android's rule: within a few seconds of the start)
 * with a short "Starting playback" notice, and keeps that state until playback is under
 * way and the media service holds its own (PlayStart.next).
 */
public class PlayActionService extends Service {
    private static final String TAG = "Daylight-Media";
    private static final String CHANNEL = "daylight_play_start";
    private static final int NOTICE_ID = 0x0da7;
    private static final long PAYLOAD_WAIT_MS = 8000;
    private static final long POLL_MS = 500;

    private final Handler main = new Handler(Looper.getMainLooper());
    private ListenableFuture<MediaController> pending;
    private MediaController controller;
    private long startedAt;
    private boolean failed;
    private boolean playedOnce;
    private boolean busy;

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // First, before anything can fail: a service started as a foreground service that
        // does not call startForeground in time is stopped by Android with an error.
        try {
            enterForeground();
        } catch (RuntimeException refused) {
            Log.w(TAG, "play service could not enter the foreground: " + refused.getClass().getSimpleName());
            stopSelf();
            return START_NOT_STICKY;
        }
        final String actionId = DirectPlay.actionFrom(intent == null ? null : intent.getStringExtra(DirectPlay.EXTRA_ACTION));
        if (actionId == null || busy) {
            // A second tap while one is starting is dropped: the first one plays.
            if (!busy) finish(null);
            return START_NOT_STICKY;
        }
        busy = true;
        startedAt = SystemClock.elapsedRealtime();
        // The payload may not be loaded (a tap in a cold process). This service is in the
        // foreground, so starting the shell service is a start from a foreground app.
        ShellStart.ensure(this);
        Thread ask = new Thread(() -> {
            String mediaId;
            try {
                mediaId = PlayStart.mediaId(new PayloadMedia().action(actionId, PAYLOAD_WAIT_MS));
            } catch (Throwable notReadyOrRefused) {
                mediaId = null;
            }
            final String id = mediaId;
            main.post(() -> {
                if (id == null) { failed = true; step(); } else play(id);
            });
        }, "Daylight-play-action");
        ask.setDaemon(true);
        ask.start();
        main.postDelayed(this::step, POLL_MS);
        // Only the action id is logged: content and links never are.
        Log.i(TAG, "play action " + actionId);
        return START_NOT_STICKY;
    }

    private void enterForeground() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Starting playback", NotificationManager.IMPORTANCE_LOW));
        }
        Notification notice = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle("Starting playback")
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTICE_ID, notice, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(NOTICE_ID, notice);
    }

    private void play(final String mediaId) {
        try {
            SessionToken token = new SessionToken(this, new ComponentName(this, DaylightMediaService.class));
            pending = new MediaController.Builder(this, token).buildAsync();
            pending.addListener(() -> {
                try {
                    controller = pending.get();
                    controller.addListener(new Player.Listener() {
                        @Override public void onIsPlayingChanged(boolean isPlaying) {
                            if (isPlaying) playedOnce = true;
                            step();
                        }
                        @Override public void onPlayerError(PlaybackException error) { failed = true; step(); }
                    });
                    controller.setMediaItem(new MediaItem.Builder().setMediaId(mediaId).build());
                    controller.prepare();
                    controller.play();
                } catch (Exception e) {
                    Log.w(TAG, "no media controller: " + e.getClass().getSimpleName());
                    failed = true;
                    step();
                }
            }, main::post);
        } catch (RuntimeException e) {
            Log.w(TAG, "could not reach the media service: " + e.getClass().getSimpleName());
            failed = true;
            step();
        }
    }

    /** Main thread. */
    private void step() {
        if (!busy) return;
        main.removeCallbacksAndMessages(null);
        MediaController c = controller;
        PlayStart.Step next = PlayStart.next(SystemClock.elapsedRealtime() - startedAt, failed, playedOnce,
                c != null && c.isPlaying(), DaylightMediaService.inForeground());
        switch (next) {
            case FAIL: finish("Could not start playback"); return;
            case RELEASE: finish(null); return;
            default: main.postDelayed(this::step, POLL_MS);
        }
    }

    /** Once. Releasing the controller does not stop playback: the session keeps the player. */
    private void finish(String message) {
        busy = false;
        main.removeCallbacksAndMessages(null);
        if (message != null) Toast.makeText(getApplicationContext(), message, Toast.LENGTH_SHORT).show();
        if (controller != null) { controller.release(); controller = null; }
        else if (pending != null) MediaController.releaseFuture(pending);
        pending = null;
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        main.removeCallbacksAndMessages(null);
        if (controller != null) { controller.release(); controller = null; }
        else if (pending != null) MediaController.releaseFuture(pending);
        super.onDestroy();
    }
}
