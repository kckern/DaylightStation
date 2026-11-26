package net.kckern.daylight.cap.mediaservice.shell;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.session.MediaSession;

/**
 * The phone's sleep timer: pause after N minutes, or when the current item ends. It lives
 * in the session, not the screen, so it holds while Now playing is closed, and it says
 * what it is doing in the session extras (EXTRA_UNTIL) for any controller to show.
 * Set by the SLEEP custom command with ARG_MINUTES: a positive count, END_OF_ITEM, or 0
 * to cancel. Playback stopping or the queue clearing cancels it too.
 */
final class SleepTimer {
    static final String ACTION = "net.kckern.daylight.media.SLEEP";
    static final String ARG_MINUTES = "minutes";
    /** Elapsed-realtime ms when the timer pauses, or UNTIL_END_OF_ITEM; absent when off. */
    static final String EXTRA_UNTIL = "daylight.sleepUntil";
    static final int END_OF_ITEM = -1;
    static final long UNTIL_END_OF_ITEM = -1;
    private static final String TAG = "Daylight-Media";

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable fire = this::pauseNow;
    /** The last minute: the volume falls to 10% (LongForm.fadeVolume), as audiobook players do. */
    private final Runnable fade = this::fadeStep;
    private boolean fading;
    /** Where the fade goes: the session's volume mix (with loudness levelling), else the player itself. */
    private java.util.function.Consumer<Float> fadeSink;

    void setFadeSink(java.util.function.Consumer<Float> sink) { fadeSink = sink; }

    private void fadeTo(float v) {
        if (fadeSink != null) fadeSink.accept(v);
        else if (session != null) session.getPlayer().setVolume(v);
    }
    private MediaSession session;
    private long until;
    private boolean armed;

    private final Player.Listener ends = new Player.Listener() {
        @Override public void onMediaItemTransition(MediaItem item, int reason) {
            if (armed && until == UNTIL_END_OF_ITEM && reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO) {
                // The next item has just begun: pause it at its start.
                Player p = session.getPlayer();
                p.pause();
                p.seekTo(0);
                Log.i(TAG, "sleep timer: paused at the end of the item");
                cancel();
            }
        }
        @Override public void onPlaybackStateChanged(int state) {
            if (armed && (state == Player.STATE_ENDED || state == Player.STATE_IDLE)) cancel();
        }
    };

    /** Applies a SLEEP command to this session's player. */
    void set(MediaSession s, int minutes) {
        if (session != s) {
            if (session != null) session.getPlayer().removeListener(ends);
            session = s;
            s.getPlayer().addListener(ends);
        }
        main.removeCallbacks(fire);
        restoreVolume();
        if (minutes == 0) { cancel(); return; }
        armed = true;
        if (minutes == END_OF_ITEM) {
            until = UNTIL_END_OF_ITEM;
        } else {
            long ms = Math.max(1, minutes) * 60_000L;
            until = SystemClock.elapsedRealtime() + ms;
            main.postDelayed(fire, ms);
            main.postDelayed(fade, Math.max(0, ms - LongForm.FADE_MS));
        }
        Log.i(TAG, "sleep timer: " + (minutes == END_OF_ITEM ? "end of item" : minutes + " min"));
        publish();
    }

    private void fadeStep() {
        if (!armed || session == null || until == UNTIL_END_OF_ITEM) return;
        fading = true;
        long left = until - SystemClock.elapsedRealtime();
        fadeTo(LongForm.fadeVolume(left));
        if (left > 0) main.postDelayed(fade, 1000);
    }

    private void pauseNow() {
        if (!armed || session == null) return;
        session.getPlayer().pause();
        restoreVolume();
        Log.i(TAG, "sleep timer: paused");
        cancel();
    }

    private void restoreVolume() {
        main.removeCallbacks(fade);
        if (fading) fadeTo(1f);
        fading = false;
    }

    void cancel() {
        main.removeCallbacks(fire);
        restoreVolume();
        boolean was = armed;
        armed = false;
        if (was) publish();
    }

    void release() {
        main.removeCallbacks(fire);
        restoreVolume();
        shownArmed = false;
        if (session != null) session.getPlayer().removeListener(ends);
        session = null;
        armed = false;
    }

    /**
     * The timer as the screens in this process see it: Media3 1.1.1 gives a controller no
     * way to read session extras it connected after, so Now playing reads these.
     */
    private static volatile boolean shownArmed;
    private static volatile long shownUntil;

    /** "Sleep in 23 min", "Sleep at the end of this", or "" when off. */
    static String describeNow() {
        return shownArmed ? describe(shownUntil, SystemClock.elapsedRealtime()) : "";
    }

    static boolean isSet() { return shownArmed; }

    private void publish() {
        shownArmed = armed;
        shownUntil = until;
        if (session == null) return;
        // The phone's session sets no other extras (Media3 1.1.1 has no getter to merge with).
        Bundle extras = new Bundle();
        if (armed) extras.putLong(EXTRA_UNTIL, until); else extras.remove(EXTRA_UNTIL);
        session.setSessionExtras(extras);
    }

    /** "Sleep in 23 min" or "Sleep at the end of this", for a timer set to {@code until}. Pure. */
    static String describe(long until, long nowElapsed) {
        if (until == UNTIL_END_OF_ITEM) return "Sleep at the end of this";
        long left = Math.max(0, until - nowElapsed);
        return "Sleep in " + (left + 59_999) / 60_000 + " min";
    }
}
