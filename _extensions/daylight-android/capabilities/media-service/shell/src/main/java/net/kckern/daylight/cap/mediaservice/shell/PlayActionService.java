package net.kckern.daylight.cap.mediaservice.shell;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
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

import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;

import com.google.common.util.concurrent.ListenableFuture;

import net.kckern.daylight.api.DirectPlay;
import net.kckern.daylight.shellkit.ShellStart;
import net.kckern.daylight.shellkit.DirectPlayIntents;
import net.kckern.daylight.shellkit.PlaylistWidgetState;
import net.kckern.daylight.shellkit.PlaylistWidgetState.Phase;
import net.kckern.daylight.shellkit.PlaylistWidgetState.Tap;

/**
 * Plays a media action with no window: a tap on a widget button or a tile starts this
 * service in the foreground (PendingIntent.getForegroundService, or startForegroundService
 * from a tile). Connecting a MediaController starts the media session. The session resolves
 * and starts the selected action only while the widget start is still current.
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
    private static final String STOP = "net.kckern.daylight.media.STOP_START";
    private static final int NOTICE_ID = 0x0da7;
    private static final long PAYLOAD_WAIT_MS = 8000;
    private static final long POLL_MS = 500;

    private static PlayActionService current;

    private final Handler main = new Handler(Looper.getMainLooper());
    private ListenableFuture<MediaController> pending;
    private MediaController controller;
    private PlayStart.Attempt attempt;
    private int currentStartId;
    private final Runnable poll = this::step;
    private boolean failed;

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public void onCreate() {
        super.onCreate();
        current = this;
    }

    /** A media session Stop cancels any pending widget request on the same main looper. */
    static void cancelCurrentStart() {
        PlayActionService service = current;
        if (service != null && service.attempt != null) service.finish(null, service.currentStartId);
    }

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
        if (intent != null && STOP.equals(intent.getAction())) {
            stopFromNotification(() -> finish(null, startId), DaylightMediaService::stopPlayback);
            return START_NOT_STICKY;
        }
        final String actionId = DirectPlay.actionFrom(intent == null ? null : intent.getStringExtra(DirectPlay.EXTRA_ACTION));
        final String playlist = intent == null ? null : intent.getStringExtra(DirectPlayIntents.EXTRA_PLAYLIST);
        if (actionId == null && (playlist == null || !playlist.startsWith("c:"))) {
            if (attempt == null) finish(null, startId);
            else currentStartId = startId;
            return START_NOT_STICKY;
        }
        if (actionId == null) {
            Tap tap = PlaylistWidgetState.get(playlist).tap(intent.getStringExtra(DirectPlayIntents.EXTRA_PLAYLIST_REVISION));
            if (tap != Tap.START) {
                currentStartId = startId;
                if (tap == Tap.PAUSE || tap == Tap.RESUME) DaylightMediaService.controlPlaylist(playlist, tap);
                else if (PlaylistWidgetState.get(playlist).phase != Phase.STARTING) PlaylistWidgetState.redraw(this);
                if (attempt == null) {
                    if (tap == Tap.RESUME) main.postDelayed(() -> {
                        if (attempt == null && currentStartId == startId) finish(null, startId);
                    }, 3000);
                    else finish(null, startId);
                }
                return START_NOT_STICKY;
            }
        }
        releaseAttempt();
        currentStartId = startId;
        failed = false;
        PlayStart.Attempt requested = new PlayStart.Attempt(actionId == null ? playlist : null, SystemClock.elapsedRealtime(),
                actionId == null && intent.getBooleanExtra(DirectPlayIntents.EXTRA_PLAYLIST_SHUFFLE, true));
        attempt = requested;
        PlaylistWidgetState.show(this, requested.playlist, Phase.STARTING);
        ShellStart.ensure(this);
        Thread ask = new Thread(() -> {
            String mediaId;
            try {
                mediaId = actionId == null ? requested.playlist
                        : PlayStart.mediaId(new PayloadMedia().action(actionId, PAYLOAD_WAIT_MS));
            } catch (Throwable notReadyOrRefused) {
                mediaId = null;
            }
            final String id = mediaId;
            main.post(() -> {
                if (!isCurrent(requested)) return;
                if (id == null) fail(requested); else connect(requested, id);
            });
        }, "Daylight-play-action");
        ask.setDaemon(true);
        ask.start();
        main.postDelayed(poll, POLL_MS);
        Log.i(TAG, "play action " + actionId);
        return START_NOT_STICKY;
    }

    private void enterForeground() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Starting playback", NotificationManager.IMPORTANCE_LOW));
        }
        PendingIntent stop = PendingIntent.getService(this, 0,
                new Intent(this, PlayActionService.class).setAction(STOP), PendingIntent.FLAG_IMMUTABLE);
        Notification notice = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle("Starting playback")
                .setOngoing(true)
                .addAction(new Notification.Action.Builder(null, "Stop", stop).build())
                .build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTICE_ID, notice, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(NOTICE_ID, notice);
    }

    private boolean isCurrent(PlayStart.Attempt requested) {
        return requested == attempt && requested.canApply(SystemClock.elapsedRealtime());
    }

    private void connect(PlayStart.Attempt requested, String mediaId) {
        try {
            SessionToken token = new SessionToken(this, new ComponentName(this, DaylightMediaService.class));
            ListenableFuture<MediaController> connecting = new MediaController.Builder(this, token).buildAsync();
            pending = connecting;
            connecting.addListener(() -> {
                if (!isCurrent(requested)) return;
                try {
                    controller = connecting.get();
                    DaylightMediaService.playShortcut(requested, mediaId, () -> fail(requested));
                } catch (Exception e) {
                    Log.w(TAG, "no media controller: " + e.getClass().getSimpleName());
                    fail(requested);
                }
            }, main::post);
        } catch (RuntimeException e) {
            Log.w(TAG, "could not reach the media service: " + e.getClass().getSimpleName());
            fail(requested);
        }
    }

    private void fail(PlayStart.Attempt requested) {
        if (attempt != requested) return;
        failed = true;
        step();
    }

    /** Main thread. */
    private void step() {
        if (attempt == null) return;
        main.removeCallbacks(poll);
        boolean playing = DaylightMediaService.shortcutPlaying(attempt);
        long elapsed = SystemClock.elapsedRealtime() - attempt.startedAt;
        PlayStart.Step next = PlayStart.next(elapsed, failed || DaylightMediaService.shortcutFailed(attempt),
                attempt.played(), playing, DaylightMediaService.inForeground());
        switch (next) {
            case FAIL: finish("Could not start playback. Tap the button again to retry.", currentStartId); return;
            case RELEASE: finish(null, currentStartId); return;
            default: main.postDelayed(poll, attempt.played() ? POLL_MS : Math.min(POLL_MS, PlayStart.GIVE_UP_MS - elapsed));
        }
    }

    static void stopFromNotification(Runnable finishStart, Runnable stopPlayback) {
        finishStart.run();
        stopPlayback.run();
    }

    private void finish(String message, int startId) {
        String playlist = attempt == null ? null : attempt.playlist;
        releaseAttempt();
        if (message != null) PlaylistWidgetState.show(this, playlist, Phase.FAILED);
        if (message != null) Toast.makeText(getApplicationContext(), message, Toast.LENGTH_SHORT).show();
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelfResult(startId);
    }

    private void releaseAttempt() {
        main.removeCallbacks(poll);
        if (attempt != null) {
            attempt.cancel();
            if (!attempt.played()) {
                DaylightMediaService.stopShortcut(attempt);
                PlaylistWidgetState.show(this, attempt.playlist, Phase.READY);
            }
            attempt = null;
        }
        if (controller != null) controller.release();
        else if (pending != null) MediaController.releaseFuture(pending);
        controller = null;
        pending = null;
    }

    @Override public void onDestroy() {
        if (current == this) current = null;
        releaseAttempt();
        super.onDestroy();
    }
}
