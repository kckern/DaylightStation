package net.kckern.daylight.cap.mediaservice.shell;

import android.content.SharedPreferences;
import android.util.Log;

import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;

import java.util.function.BooleanSupplier;
import java.util.function.Supplier;
import java.util.function.LongSupplier;

/**
 * The phone session's rules for long items, kept in the session so Now playing, the
 * notification and the car all get them:
 * <ul>
 * <li>a long item plays at the listener's long-form speed (remembered); music always at 1x,
 *     whoever asks otherwise;</li>
 * <li>resuming a long item after a pause steps back a little (LongForm.resumeRewindMs); a
 *     seek while paused, or a new item, cancels that.</li>
 * </ul>
 */
final class LongFormPolicy implements Player.Listener {
    static final String PREFS = "daylight.playback";
    private static final String TAG = "Daylight-Media";

    private final Player player;
    private final BooleanSupplier longForm;
    private final SharedPreferences prefs;
    private final Supplier<String> speedKey;
    private final LongForm.SpeedMemory memory;
    private final LongSupplier clock;
    private long pausedAt;
    private boolean applying;
    /** The speed this policy set last: its own change, heard back later, is not a choice. */
    private float applied = 1f;

    LongFormPolicy(Player player, BooleanSupplier longForm, Supplier<String> speedKey, SharedPreferences prefs, LongSupplier clock) {
        this.player = player;
        this.longForm = longForm;
        this.speedKey = speedKey;
        this.prefs = prefs;
        this.clock = clock;
        this.memory = new LongForm.SpeedMemory() {
            @Override public float get(String key, float fallback) { return prefs.getFloat(key, fallback); }
            @Override public void put(String key, float speed) { prefs.edit().putFloat(key, speed).apply(); }
        };
    }

    /** The speed this item should play at now. */
    void apply() {
        float want = LongForm.speedFor(longForm.getAsBoolean(), speedKey.get(), memory);
        if (Math.abs(player.getPlaybackParameters().speed - want) < 0.001f) return;
        applying = true;
        applied = want;
        try { player.setPlaybackSpeed(want); } finally { applying = false; }
        Log.i(TAG, "speed " + LongForm.speedLabel(want) + (want == 1f ? "" : " (long-form)"));
    }

    @Override public void onMediaItemTransition(MediaItem item, int reason) {
        pausedAt = 0;
        apply();
    }

    @Override public void onTimelineChanged(androidx.media3.common.Timeline timeline, int reason) { apply(); }

    @Override public void onPlaybackParametersChanged(PlaybackParameters p) {
        // Media3 tells listeners later, so the flag alone does not catch the policy's own change.
        if (applying || Math.abs(p.speed - applied) < 0.001f) return;
        applied = p.speed;
        if (longForm.getAsBoolean()) {
            // Someone chose a speed for a long item: kept for this collection, and the default.
            LongForm.remember(speedKey.get(), p.speed, memory);
        } else if (Math.abs(p.speed - 1f) > 0.001f) {
            apply(); // Music is not sped up.
        }
    }

    @Override public void onPlayWhenReadyChanged(boolean playWhenReady, int reason) {
        if (!playWhenReady) { pausedAt = clock.getAsLong(); return; }
        long was = pausedAt;
        pausedAt = 0;
        if (was <= 0 || !longForm.getAsBoolean()) return;
        long back = LongForm.resumeRewindMs(clock.getAsLong() - was);
        if (back <= 0) return;
        long to = Math.max(0, player.getCurrentPosition() - back);
        player.seekTo(to);
        Log.i(TAG, "resume rewind " + back / 1000 + " s");
    }

    @Override public void onPositionDiscontinuity(Player.PositionInfo oldPosition, Player.PositionInfo newPosition, int reason) {
        // A seek while paused chose where to resume: no step back on top of it.
        if (reason == Player.DISCONTINUITY_REASON_SEEK && !player.getPlayWhenReady()) pausedAt = 0;
    }
}
