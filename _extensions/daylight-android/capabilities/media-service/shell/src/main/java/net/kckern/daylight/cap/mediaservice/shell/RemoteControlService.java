package net.kckern.daylight.cap.mediaservice.shell;

import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

import androidx.media3.common.Player;

import net.kckern.daylight.shellkit.NowPlayingNote;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import androidx.media3.session.SessionCommand;
import androidx.media3.session.SessionCommands;
import androidx.media3.session.SessionResult;

import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;

import net.kckern.daylight.shellkit.ShellStart;

import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The phone as a remote for one screen. A second Media3 session beside the phone's own
 * (DaylightMediaService), holding a ScreenPlayer: the Now playing screen, the media
 * notification and the lock-screen card drive the screen through it, and the phone's
 * volume keys set the screen's volume while it is the active session.
 *
 * Not exported: only this app binds it (the Now playing screen) and the system reads it
 * through the notification. The screen is chosen with the TARGET custom command and
 * remembered, so a tap on the notification after the app was closed finds it again.
 *
 * It reads the screen's session every second while the Now playing screen is on view
 * (WATCH), every five seconds while the screen plays, and every fifteen otherwise. After
 * ten minutes of a screen not playing and nobody watching it stops reading and stops
 * itself (it then ends once nothing is bound). Choosing a screen in the app also starts
 * it, so a paused screen keeps its notification after the app is closed. Host, do not decide: what a command means and which
 * screens exist are the payload's (ScreenRemote).
 */
public class RemoteControlService extends MediaSessionService {
    private static final String TAG = "Daylight-Media";
    static final String SESSION_ID = "screen-remote";
    static final String TARGET = "net.kckern.daylight.remote.TARGET";
    static final String WATCH = "net.kckern.daylight.remote.WATCH";
    static final String EXTRA_DEVICE = "device";
    static final String EXTRA_NAME = "name";
    static final String EXTRA_ON = "on";
    /** Session extra: the line under the controls. */
    static final String EXTRA_STATUS = "status";
    static final String PREFS = "daylight.remote";
    private static final long WAIT_MS = 4000;
    private static final long WATCHED_MS = 1000, PLAYING_MS = 5000, RESTING_MS = 15000;
    private static final long REST_AFTER_MS = 10 * 60_000;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable tick = this::tick;
    private final Set<MediaSession.ControllerInfo> watchers = new HashSet<>();
    private ExecutorService io;
    private ExecutorService commandIo;
    private ScreenPlayer player;
    private MediaSession session;
    private SharedPreferences prefs;
    private final Bundle extras = new Bundle();
    private long activeAt;
    private boolean resting;
    /** A tick is posted. Handler.hasCallbacks is API 29; the phone's floor is 26. */
    private boolean ticking;

    @Override
    public void onCreate() {
        super.onCreate();
        ShellStart.ensure(this);
        io = Executors.newFixedThreadPool(2, r -> {
            Thread t = new Thread(r, "Daylight-remote-io");
            t.setDaemon(true);
            return t;
        });
        // Commands one at a time, in order, on their own thread: a slow read never holds a tap.
        commandIo = Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "Daylight-remote-commands");
            t.setDaemon(true);
            return t;
        });
        PayloadMedia media = new PayloadMedia();
        player = new ScreenPlayer(Looper.getMainLooper(), io, commandIo, new ScreenPlayer.Link() {
            @Override public JSONObject session(String device) throws Exception {
                return new JSONObject(media.screenSession(device, WAIT_MS));
            }
            @Override public JSONObject command(JSONObject request) throws Exception {
                return new JSONObject(media.screenCommand(request, WAIT_MS));
            }
        }, line -> {
            extras.putString(EXTRA_STATUS, line);
            if (session != null) session.setSessionExtras(new Bundle(extras));
        });
        player.addListener(new Player.Listener() {
            @Override public void onEvents(Player p, Player.Events events) {
                if (p.getPlayWhenReady()) markActive();
                note(p);
            }
        });

        session = new MediaSession.Builder(this, player)
                .setId(SESSION_ID)
                .setCallback(new Callback())
                .setSessionActivity(nowPlaying(null))
                .build();

        // Media3 starts the foreground itself when the screen plays; from the background
        // Android 12+ may refuse that (a poll is not a tap). Media3 catches it and says so here.
        setListener(new Listener() {
            @Override public void onForegroundServiceStartNotAllowedException() {
                Log.w(TAG, "Android refused the remote's foreground start; the notification shows when the app is next open");
            }
        });

        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String device = prefs.getString(EXTRA_DEVICE, null);
        if (device != null) target(device, prefs.getString(EXTRA_NAME, device));
        Log.i(TAG, "remote service created");
    }

    private PendingIntent nowPlaying(String device) {
        Intent open = new Intent(this, NowPlayingActivity.class)
                .putExtra(NowPlayingActivity.EXTRA_TARGET, device == null ? "" : device)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private void target(String device, String name) {
        player.setScreen(device, name);
        // Started as well as bound: the remote outlives the Now playing screen, so a paused TV
        // keeps its notification. Allowed here: TARGET comes from this app's open screen.
        // From a cold restart in the background Android may refuse; then it lives while bound.
        try {
            startService(new Intent(this, RemoteControlService.class));
        } catch (RuntimeException backgroundStartRefused) {
            Log.i(TAG, "remote not started (background): bound only");
        }
        prefs.edit().putString(EXTRA_DEVICE, device).putString(EXTRA_NAME, name).apply();
        session.setSessionActivity(nowPlaying(device));
        markActive();
    }

    private void markActive() {
        activeAt = SystemClock.elapsedRealtime();
        if (resting) {
            resting = false;
            Log.i(TAG, "remote reading again");
            schedule(0);
        } else if (!ticking) {
            schedule(0);
        }
    }

    private void schedule(long delayMs) {
        main.removeCallbacks(tick);
        ticking = true;
        main.postDelayed(tick, delayMs);
    }

    private void tick() {
        ticking = false;
        if (player == null || player.device() == null) return;
        boolean watched = !watchers.isEmpty();
        boolean playing = player.getPlayWhenReady();
        if (!watched && !playing && SystemClock.elapsedRealtime() - activeAt > REST_AFTER_MS) {
            resting = true;
            Log.i(TAG, "remote resting: screen not playing and nobody watching");
            // No longer kept on its own: it ends once nothing is bound (the notification goes too).
            stopSelf();
            return;
        }
        player.refresh();
        schedule(watched ? WATCHED_MS : playing ? PLAYING_MS : RESTING_MS);
    }

    private final class Callback implements MediaSession.Callback {
        @Override public MediaSession.ConnectionResult onConnect(MediaSession s, MediaSession.ControllerInfo controller) {
            SessionCommands.Builder commands = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon();
            // Only this app picks the screen or says it is watching; the system's controls
            // (notification, lock screen) get the player commands alone.
            if (getPackageName().equals(controller.getPackageName())) {
                commands.add(new SessionCommand(TARGET, Bundle.EMPTY)).add(new SessionCommand(WATCH, Bundle.EMPTY));
            }
            return MediaSession.ConnectionResult.accept(commands.build(), MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS);
        }

        @Override public void onPostConnect(MediaSession s, MediaSession.ControllerInfo controller) {
            s.setSessionExtras(controller, new Bundle(extras));
        }

        @Override public void onDisconnected(MediaSession s, MediaSession.ControllerInfo controller) {
            watchers.remove(controller);
        }

        @Override public ListenableFuture<SessionResult> onCustomCommand(MediaSession s, MediaSession.ControllerInfo controller,
                SessionCommand command, Bundle args) {
            if (TARGET.equals(command.customAction)) {
                String device = args.getString(EXTRA_DEVICE, "");
                if (!device.matches("[a-z0-9][a-z0-9-]{0,63}")) {
                    return Futures.immediateFuture(new SessionResult(SessionResult.RESULT_ERROR_BAD_VALUE));
                }
                target(device, args.getString(EXTRA_NAME, device));
            } else if (WATCH.equals(command.customAction)) {
                if (args.getBoolean(EXTRA_ON, false)) { watchers.add(controller); markActive(); }
                else watchers.remove(controller);
                schedule(0);
            } else {
                return Futures.immediateFuture(new SessionResult(SessionResult.RESULT_ERROR_NOT_SUPPORTED));
            }
            return Futures.immediateFuture(new SessionResult(SessionResult.RESULT_SUCCESS));
        }
    }

    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return session;
    }

    /** The app was swiped away: keep the remote while the screen plays, otherwise go. */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        if (player == null || !player.getPlayWhenReady()) stopSelf();
    }

    /** The device the home's "Playing on" strip was last told about. */
    private String noted;

    /** Tells the home's "Playing on" strip what this screen plays (in process only). */
    private void note(Player p) {
        String device = prefs == null ? null : prefs.getString(EXTRA_DEVICE, null);
        if (device == null) return;
        if (noted != null && !noted.equals(device)) NowPlayingNote.update(noted, "", "", false, SystemClock.elapsedRealtime());
        noted = device;
        CharSequence title = p.getMediaItemCount() == 0 ? null : p.getMediaMetadata().title;
        boolean playing = p.getPlayWhenReady() && p.getPlaybackState() == Player.STATE_READY;
        NowPlayingNote.update(device, prefs.getString(EXTRA_NAME, device), title == null ? "" : title.toString(),
                playing, SystemClock.elapsedRealtime());
    }

    @Override
    public void onDestroy() {
        main.removeCallbacksAndMessages(null);
        if (noted != null) NowPlayingNote.update(noted, "", "", false, SystemClock.elapsedRealtime());
        if (session != null) { session.release(); session = null; }
        if (player != null) { player.release(); player = null; }
        if (io != null) { io.shutdown(); io = null; }
        if (commandIo != null) { commandIo.shutdown(); commandIo = null; }
        clearListener();
        Log.i(TAG, "remote service destroyed");
        super.onDestroy();
    }
}
