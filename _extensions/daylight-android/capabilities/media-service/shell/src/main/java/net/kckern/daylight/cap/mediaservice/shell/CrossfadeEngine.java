package net.kckern.daylight.cap.mediaservice.shell;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.Timeline;
import androidx.media3.datasource.DataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.PlayerMessage;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;

import net.kckern.daylight.shellkit.UiTelemetry;

import org.json.JSONObject;

/**
 * Crossfade between songs on this phone's own player (spec:
 * ops:docs/superpowers/specs/2026-11-26-phone-crossfade.md; rules in {@link Crossfade}).
 *
 * The session's ExoPlayer stays the one truth for the queue, the notification, the car
 * and progress. A private "tail" ExoPlayer plays only the last seconds of the outgoing
 * song: prepared at the fade point 15 s ahead, started there (a PlayerMessage at that
 * playback position) while the main player moves to the next item silently, then both
 * ramp on an equal-power curve. Anything the person does during a fade (pause, seek, skip,
 * a call) ends it: the tail stops and the incoming song is at full level.
 *
 * Main thread only. Never used for a screen (the remote player is another service).
 */
final class CrossfadeEngine implements Player.Listener {
    private static final String TAG = "Daylight-Media";
    static final String PREFS = "daylight.player";
    /** The person's choice, seconds (absent until they choose). */
    static final String KEY_CHOSEN = "crossfadeSec";
    /** The device default from media.crossfadeSec, as the payload last said. */
    static final String KEY_DEFAULT = "crossfadeDefault";
    /** How late the outgoing copy starts on this device, learned from each fade (ms). */
    static final String KEY_LEAD = "crossfadeTailLeadMs";

    /** The loudness mix the service owns. */
    interface Mix {
        /** The loudness level of an item (Plex gain, never above full). */
        float levelOf(MediaItem item);
        /** The sleep timer's fade multiplier now (1 when not fading). */
        float sleepFade();
        /** The incoming song's fade gain, multiplied into the main player's volume. */
        void incomingGain(float gain);
    }

    /** Reports the outgoing song as played to its end. */
    interface Finished {
        void finished(MediaItem item, long durationMs);
    }

    private final Context context;
    private final ExoPlayer main;
    private final DataSource.Factory source;
    private final Mix mix;
    private final Finished finished;
    private final SharedPreferences prefs;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable step = this::step;
    private final Runnable replan = this::replan;
    private final SharedPreferences.OnSharedPreferenceChangeListener settingChanged = (p, key) -> {
        if (KEY_CHOSEN.equals(key) || KEY_DEFAULT.equals(key)) scheduleReplan();
    };

    private ExoPlayer tail;
    private PlayerMessage prepareMessage, startMessage;
    private Crossfade.Plan plan;
    private int planIndex = C.INDEX_UNSET;
    private MediaItem planItem;
    private String lastPlanLine = "";

    private boolean fading;
    private boolean ownSeek;
    private long fadeStartedAt;
    private long fadeMs;
    private float outLevel = 1f;
    private boolean loggedMiddle;
    private boolean cutting;

    CrossfadeEngine(Context context, ExoPlayer main, DataSource.Factory source, Mix mix, Finished finished) {
        this.context = context.getApplicationContext();
        this.main = main;
        this.source = source;
        this.mix = mix;
        this.finished = finished;
        this.prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.registerOnSharedPreferenceChangeListener(settingChanged);
        main.addListener(this);
    }

    /** The seconds in force now: the person's choice, else the device default. */
    int seconds() {
        Integer chosen = prefs.contains(KEY_CHOSEN) ? prefs.getInt(KEY_CHOSEN, Crossfade.DEFAULT_SEC) : null;
        Integer deviceDefault = prefs.contains(KEY_DEFAULT) ? prefs.getInt(KEY_DEFAULT, Crossfade.DEFAULT_SEC) : null;
        return Crossfade.seconds(chosen, deviceDefault);
    }

    /** The device default, from the payload's media.crossfadeSec. */
    static void rememberDefault(Context context, int seconds) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putInt(KEY_DEFAULT, seconds).apply();
    }

    // ── the plan ─────────────────────────────────────────────────────────────

    private void scheduleReplan() {
        handler.removeCallbacks(replan);
        handler.post(replan);
    }

    /** (Re)makes the plan for the transition out of the current item. */
    private void replan() {
        cancelMessages();
        if (fading) return;
        int index = main.getCurrentMediaItemIndex();
        MediaItem current = main.getCurrentMediaItem();
        if (current == null || main.getPlaybackState() == Player.STATE_IDLE || main.getPlaybackState() == Player.STATE_ENDED) {
            releaseTail();
            plan = null;
            return;
        }
        int nextIndex = main.getNextMediaItemIndex();
        MediaItem next = nextIndex == C.INDEX_UNSET ? null : main.getMediaItemAt(nextIndex);
        long position = main.getCurrentPosition();
        Crossfade.Plan p = Crossfade.plan(seconds(), side(current, main.getDuration()), next == null ? null : side(next, C.TIME_UNSET),
                main.getShuffleModeEnabled(), main.getRepeatMode() == Player.REPEAT_MODE_ONE, SleepTimer.isSet(), position);
        plan = p;
        planIndex = index;
        planItem = current;
        String line = "crossfade: plan for " + current.mediaId + ": " + p;
        if (!line.equals(lastPlanLine)) {
            Log.i(TAG, line);
            lastPlanLine = line;
        }
        if (!p.fades()) {
            releaseTail();
            if (p.skip == Crossfade.Skip.TOO_LATE) skipped("too_late");
            return;
        }
        long prepareAt = Crossfade.prepareAtMs(p, position);
        if (prepareAt <= position) {
            prepareTail();
        } else {
            prepareMessage = main.createMessage((type, payload) -> prepareTail())
                    .setLooper(Looper.getMainLooper()).setPosition(index, prepareAt).setDeleteAfterDelivery(true).send();
        }
        startMessage = main.createMessage((type, payload) -> startFade())
                .setLooper(Looper.getMainLooper()).setPosition(index, p.startMs).setDeleteAfterDelivery(true).send();
    }

    private static Crossfade.Side side(MediaItem item, long playerDurationMs) {
        long duration = NodeItems.durationMs(item, playerDurationMs);
        if (duration == C.TIME_UNSET) duration = 0;
        CharSequence album = item.mediaMetadata.albumTitle, artist = item.mediaMetadata.artist;
        return new Crossfade.Side(CarControls.longForm(NodeItems.listId(item), duration), duration,
                album == null ? "" : album.toString(), artist == null ? "" : artist.toString());
    }

    private void cancelMessages() {
        if (prepareMessage != null) prepareMessage.cancel();
        if (startMessage != null) startMessage.cancel();
        prepareMessage = startMessage = null;
    }

    // ── the outgoing copy ────────────────────────────────────────────────────

    private void prepareTail() {
        if (fading || plan == null || !plan.fades() || planItem == null) return;
        if (main.getCurrentMediaItemIndex() != planIndex) return;
        if (tail == null) {
            // No audio focus of its own: the main player owns it, and a pause there ends a fade.
            tail = new ExoPlayer.Builder(context)
                    .setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), false)
                    .setMediaSourceFactory(new DefaultMediaSourceFactory(source))
                    .build();
            tail.addListener(new Player.Listener() {
                @Override public void onPlayerError(PlaybackException error) {
                    Log.w(TAG, "crossfade: outgoing copy failed: " + error.getErrorCodeName());
                    if (fading) finish("tail_error");
                    else releaseTail();
                }
            });
        }
        tail.setVolume(0f);
        tail.setPlayWhenReady(false);
        // The copy takes a moment to start sounding: it is placed that much later in the song,
        // so the outgoing music carries on without a gap or a repeat at the hand-over.
        long lead = prefs.getLong(KEY_LEAD, 0);
        tail.setMediaItem(planItem, plan.startMs + lead);
        tail.prepare();
        Log.i(TAG, "crossfade: outgoing copy prepared at " + plan.startMs + " ms (+" + lead + " ms start-up)");
    }

    private void releaseTail() {
        if (tail == null) return;
        tail.release();
        tail = null;
    }

    // ── the fade ─────────────────────────────────────────────────────────────

    private void startFade() {
        if (fading || plan == null || !plan.fades()) return;
        if (main.getCurrentMediaItemIndex() != planIndex || !main.getPlayWhenReady()) return;
        // A sleep timer set after the plan was made: its own fade and end-of-item pause win.
        if (SleepTimer.isSet()) { releaseTail(); return; }
        if (tail == null || tail.getPlaybackState() != Player.STATE_READY) {
            Log.i(TAG, "crossfade: no fade, the outgoing copy was not ready");
            skipped("tail_not_ready");
            return;
        }
        MediaItem outgoing = planItem;
        long duration = NodeItems.durationMs(outgoing, main.getDuration());
        outLevel = mix.levelOf(outgoing);
        fadeMs = plan.fadeMs;
        fading = true;
        loggedMiddle = false;
        tail.setVolume(outLevel * mix.sleepFade());
        tail.play();
        // The outgoing song has, for the listener, played to its end.
        finished.finished(outgoing, duration);
        mix.incomingGain(0f);
        ownSeek = true;
        try {
            main.seekToNextMediaItem();
        } finally {
            ownSeek = false;
        }
        fadeStartedAt = SystemClock.elapsedRealtime();
        Log.i(TAG, "crossfade: start " + fadeMs + " ms, out " + outgoing.mediaId + " -> in "
                + (main.getCurrentMediaItem() == null ? "?" : main.getCurrentMediaItem().mediaId)
                + " (out level " + Math.round(outLevel * 100) + "%)");
        handler.post(step);
    }

    private void step() {
        if (!fading) return;
        float p = Crossfade.progress(SystemClock.elapsedRealtime() - fadeStartedAt, fadeMs);
        float in = Crossfade.inGain(p), out = Crossfade.outGain(p);
        mix.incomingGain(in);
        if (tail != null) tail.setVolume(outLevel * mix.sleepFade() * out);
        if (!loggedMiddle && p >= 0.5f) {
            loggedMiddle = true;
            learnLead(SystemClock.elapsedRealtime() - fadeStartedAt);
            Log.i(TAG, String.format(java.util.Locale.ROOT, "crossfade: middle p=%.2f out=%.2f in=%.2f%s", p, out, in,
                    tail == null ? "" : " outgoing at " + tail.getCurrentPosition() + " ms"));
        }
        if (p >= 1f) {
            finish("done");
            return;
        }
        handler.postDelayed(step, 1000 / Crossfade.STEPS_PER_SEC);
    }

    /**
     * Compares where the copy is with where the song would be had it never left the main
     * player, and keeps a running estimate of the start-up delay (half old, half new; 0–400 ms).
     */
    private void learnLead(long elapsedMs) {
        if (tail == null || plan == null) return;
        long expected = plan.startMs + elapsedMs;
        long lead = prefs.getLong(KEY_LEAD, 0);
        long behind = expected - tail.getCurrentPosition();
        long next = Crossfade.nextLead(lead, behind);
        prefs.edit().putLong(KEY_LEAD, next).apply();
        Log.i(TAG, "crossfade: outgoing copy " + behind + " ms off the song's own time; start-up now " + next + " ms");
    }

    /** Ends a fade now (or at its natural end): the incoming song at full level, the copy gone. */
    private void finish(String reason) {
        if (!fading) return;
        fading = false;
        handler.removeCallbacks(step);
        mix.incomingGain(1f);
        long ran = SystemClock.elapsedRealtime() - fadeStartedAt;
        releaseTail();
        Log.i(TAG, "crossfade: " + ("done".equals(reason) ? "done" : "ended early (" + reason + ")") + " after " + ran + " ms");
        try {
            JSONObject e = new JSONObject().put("fadeMs", fadeMs).put("ranMs", ran);
            if ("done".equals(reason)) UiTelemetry.event("Player", "crossfade.done", e);
            else UiTelemetry.event("Player", "crossfade.ended_early", e.put("reason", reason));
        } catch (Exception ignored) { }
        scheduleReplan();
    }

    private static void skipped(String reason) {
        try { UiTelemetry.event("Player", "crossfade.skipped", new JSONObject().put("reason", reason)); }
        catch (Exception ignored) { }
    }

    /**
     * A manual skip: a 150 ms fade-out so the cut does not click, then {@code skip}; the
     * new song starts at full level. A skip during a fade ends the fade first. With
     * crossfade off, or for long-form, the skip is immediate as before.
     */
    void cut(Runnable skip, boolean longForm) {
        if (fading) finish("skip");
        if (cutting) return;
        if (seconds() <= 0 || longForm || !main.isPlaying()) {
            skip.run();
            return;
        }
        cutting = true;
        Log.i(TAG, "crossfade: skip, a " + Crossfade.CUT_MS + " ms cut (no fade)");
        long began = SystemClock.elapsedRealtime();
        handler.post(new Runnable() {
            @Override public void run() {
                long t = SystemClock.elapsedRealtime() - began;
                mix.incomingGain(Crossfade.cutGain(t));
                if (t < Crossfade.CUT_MS) {
                    handler.postDelayed(this, 25);
                    return;
                }
                cutting = false;
                try {
                    skip.run();
                } finally {
                    mix.incomingGain(1f);
                }
            }
        });
    }

    /** Stops everything; the service is going away. */
    void release() {
        if (fading) finish("stop");
        cancelMessages();
        handler.removeCallbacks(replan);
        releaseTail();
        prefs.unregisterOnSharedPreferenceChangeListener(settingChanged);
        main.removeListener(this);
    }

    // ── what the main player does ────────────────────────────────────────────

    @Override public void onMediaItemTransition(MediaItem item, int reason) {
        if (ownSeek) return;
        if (fading) finish(reason == Player.MEDIA_ITEM_TRANSITION_REASON_SEEK ? "skip" : "queue");
        scheduleReplan();
    }

    @Override public void onPositionDiscontinuity(Player.PositionInfo oldPosition, Player.PositionInfo newPosition, int reason) {
        if (ownSeek) return;
        // A seek adjustment is the player settling the position it was asked for (after our
        // own move to the next song too): not the person, so it never ends a fade.
        if (reason == Player.DISCONTINUITY_REASON_SEEK_ADJUSTMENT) {
            if (!fading) scheduleReplan();
            return;
        }
        if (reason == Player.DISCONTINUITY_REASON_SEEK) {
            if (fading) {
                // The incoming song being put at its start right after our own move is ours too.
                boolean ourStart = SystemClock.elapsedRealtime() - fadeStartedAt < 1000
                        && newPosition.mediaItemIndex == main.getCurrentMediaItemIndex() && newPosition.positionMs < 1000;
                if (ourStart) return;
                Log.i(TAG, "crossfade: seek to " + newPosition.positionMs + " ms in item " + newPosition.mediaItemIndex);
                finish("seek");
            }
            scheduleReplan();
        }
    }

    @Override public void onPlayWhenReadyChanged(boolean playWhenReady, int reason) {
        // Pause, a call (audio focus), headphones unplugged: the fade ends.
        if (!playWhenReady && fading) finish("pause");
        if (playWhenReady) scheduleReplan();
    }

    @Override public void onPlaybackSuppressionReasonChanged(int reason) {
        if (reason != Player.PLAYBACK_SUPPRESSION_REASON_NONE && fading) finish("focus");
    }

    @Override public void onPlaybackStateChanged(int state) {
        if ((state == Player.STATE_IDLE || state == Player.STATE_ENDED) && fading) finish("stop");
        if (state == Player.STATE_READY || state == Player.STATE_IDLE || state == Player.STATE_ENDED) scheduleReplan();
    }

    @Override public void onPlayerError(PlaybackException error) {
        if (fading) finish("error");
    }

    @Override public void onTimelineChanged(Timeline timeline, int reason) {
        scheduleReplan();
    }

    @Override public void onShuffleModeEnabledChanged(boolean enabled) { scheduleReplan(); }

    @Override public void onRepeatModeChanged(int mode) { scheduleReplan(); }
}
