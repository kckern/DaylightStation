package net.kckern.daylight.cap.mediaservice.shell;

import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

import androidx.media3.common.C;
import androidx.media3.common.DeviceInfo;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.SimpleBasePlayer;

import com.google.common.collect.ImmutableList;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.common.util.concurrent.SettableFuture;

import org.json.JSONObject;

import java.util.List;
import java.util.concurrent.Executor;

/**
 * A screen's session (the living-room TV, the office) as a Media3 Player, so the same
 * controller, notification and lock-screen card that drive this phone's own playback
 * drive a screen. The adapter pattern of the benchmark (ops:docs/_wip/audits/
 * 2026-11-25-player-benchmark-jellyfin-navidrome.md): Media3's Player interface is the
 * one player contract, and the commands it makes available are what the screen can do.
 *
 * The screen owns its session. What this player shows is the screen's last answer, with
 * the position carried forward while it plays; a command is sent, and its future
 * completes only once the screen's session has been read again, so the controls settle
 * on what the screen did rather than on what was asked. A command the screen did not
 * confirm is reported on the status line, never shown as done.
 *
 * Main thread only, like every Player. The network is the payload's (Link, on io).
 */
final class ScreenPlayer extends SimpleBasePlayer {
    private static final String TAG = "Daylight-Media";
    /** How long a refused command's line stays up before the screen's own line returns. */
    private static final long COMMAND_LINE_MS = 8000;

    /** The payload's screen ops. Called on io, never on the main thread. */
    interface Link {
        JSONObject session(String device) throws Exception;
        JSONObject command(JSONObject request) throws Exception;
    }

    /** The line under the controls changed ("Office Screen is off", "Paused by Phone"). */
    interface Status { void changed(String line); }

    private final Handler main;
    private final Executor io;
    private final Link link;
    private final Status status;

    private String device;
    private String name = "";
    private ScreenSnapshot snap = ScreenSnapshot.unreachable();
    private long snapAt;
    private long generation;
    private boolean reading;
    private String commandLine = "";
    private long commandLineAt;
    private String shownLine;

    ScreenPlayer(Looper looper, Executor io, Link link, Status status) {
        super(looper);
        this.main = new Handler(looper);
        this.io = io;
        this.link = link;
        this.status = status;
    }

    /** Points the player at a screen. The previous screen's answers still in flight are dropped. */
    void setScreen(String device, String name) {
        if (device != null && device.equals(this.device)) { refresh(); return; }
        generation++;
        this.device = device;
        this.name = name == null || name.isEmpty() ? String.valueOf(device) : name;
        snap = ScreenSnapshot.unreachable();
        snapAt = SystemClock.elapsedRealtime();
        reading = false;
        commandLine = "";
        Log.i(TAG, "remote screen " + device);
        invalidateState();
        refresh();
    }

    String device() { return device; }

    String screenName() { return name; }

    ScreenSnapshot snapshot() { return snap; }

    /** Reads the screen's session once; a read already in flight is not doubled. */
    void refresh() {
        if (device == null || reading) return;
        reading = true;
        final long gen = generation;
        final String target = device;
        io.execute(() -> {
            ScreenSnapshot answer = read(target);
            main.post(() -> {
                if (gen != generation) return;
                reading = false;
                apply(answer);
            });
        });
    }

    private ScreenSnapshot read(String target) {
        try {
            return ScreenSnapshot.parse(link.session(target));
        } catch (Exception unreachable) {
            return ScreenSnapshot.unreachable();
        }
    }

    private void apply(ScreenSnapshot answer) {
        snap = answer;
        snapAt = SystemClock.elapsedRealtime();
        invalidateState();
        publishStatus();
    }

    private void publishStatus() {
        String line = !commandLine.isEmpty() && SystemClock.elapsedRealtime() - commandLineAt < COMMAND_LINE_MS
                ? commandLine : snap.statusLine(name);
        if (line.equals(shownLine)) return;
        shownLine = line;
        status.changed(line);
    }

    // ── the state Media3 reads ───────────────────────────────────────────────

    @Override protected State getState() {
        State.Builder b = new State.Builder()
                .setAvailableCommands(commands())
                .setDeviceInfo(new DeviceInfo(DeviceInfo.PLAYBACK_TYPE_REMOTE, 0, 100))
                .setDeviceVolume(Math.max(0, snap.volume))
                .setShuffleModeEnabled(snap.shuffle)
                .setRepeatMode(ScreenCommands.repeatMode(snap.repeat))
                .setSeekBackIncrementMs(CarControls.SEEK_STEP_MS)
                .setSeekForwardIncrementMs(CarControls.SEEK_STEP_MS)
                .setPlayWhenReady(ScreenCommands.playWhenReady(snap), Player.PLAY_WHEN_READY_CHANGE_REASON_REMOTE)
                .setPlaybackState(ScreenCommands.playbackState(snap));
        if ("error".equals(snap.state) && snap.online()) {
            b.setPlayerError(new PlaybackException(name + " could not play this", null,
                    PlaybackException.ERROR_CODE_REMOTE_ERROR));
        }
        if (!snap.entries.isEmpty()) {
            ImmutableList.Builder<MediaItemData> playlist = ImmutableList.builder();
            for (ScreenSnapshot.Entry e : snap.entries) playlist.add(item(e));
            b.setPlaylist(playlist.build());
            b.setCurrentMediaItemIndex(Math.max(0, snap.current));
            b.setContentPositionMs(position());
        }
        return b.build();
    }

    private MediaItemData item(ScreenSnapshot.Entry e) {
        MediaMetadata.Builder meta = new MediaMetadata.Builder()
                .setTitle(e.title).setArtist(name).setDisplayTitle(e.title);
        if (e.thumbnail.startsWith("https://")) meta.setArtworkUri(Uri.parse(e.thumbnail));
        MediaItem media = new MediaItem.Builder().setMediaId(e.contentId).setMediaMetadata(meta.build()).build();
        return new MediaItemData.Builder(e.queueItemId)
                .setMediaItem(media)
                .setDurationUs(e.durationMs > 0 ? e.durationMs * 1000 : C.TIME_UNSET)
                .setIsSeekable(e.durationMs > 0)
                .build();
    }

    /** The screen's position carried forward while it plays; capped at the item's length. */
    private PositionSupplier position() {
        long at = snap.positionMs;
        boolean moving = "playing".equals(snap.state) && snap.online();
        if (moving) at += SystemClock.elapsedRealtime() - snapAt;
        ScreenSnapshot.Entry current = snap.currentEntry();
        if (current != null && current.durationMs > 0) at = Math.min(at, current.durationMs);
        return moving ? PositionSupplier.getExtrapolating(at, 1f) : PositionSupplier.getConstant(at);
    }

    /** What the screen can be asked now: the declared capabilities of this target. */
    private Commands commands() {
        Commands.Builder c = new Commands.Builder().addAll(
                COMMAND_GET_CURRENT_MEDIA_ITEM, COMMAND_GET_TIMELINE, COMMAND_GET_METADATA, COMMAND_GET_DEVICE_VOLUME);
        if (device == null || !snap.online()) return c.build();
        c.addAll(COMMAND_SET_DEVICE_VOLUME, COMMAND_ADJUST_DEVICE_VOLUME,
                COMMAND_SET_DEVICE_VOLUME_WITH_FLAGS, COMMAND_ADJUST_DEVICE_VOLUME_WITH_FLAGS);
        if (snap.entries.isEmpty()) return c.build();
        c.addAll(COMMAND_PLAY_PAUSE, COMMAND_STOP, COMMAND_SEEK_TO_NEXT, COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
                COMMAND_SEEK_TO_PREVIOUS, COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM, COMMAND_SEEK_BACK,
                COMMAND_SEEK_FORWARD, COMMAND_SEEK_TO_MEDIA_ITEM, COMMAND_SEEK_TO_DEFAULT_POSITION,
                COMMAND_CHANGE_MEDIA_ITEMS, COMMAND_SET_SHUFFLE_MODE, COMMAND_SET_REPEAT_MODE);
        ScreenSnapshot.Entry current = snap.currentEntry();
        if (current != null && current.durationMs > 0) c.add(COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM);
        return c.build();
    }

    // ── what Media3 asks of it ───────────────────────────────────────────────

    @Override protected ListenableFuture<?> handleSetPlayWhenReady(boolean playWhenReady) {
        return send(ScreenCommands.playWhenReady(device, playWhenReady));
    }

    @Override protected ListenableFuture<?> handlePrepare() {
        refresh();
        return Futures.immediateVoidFuture();
    }

    @Override protected ListenableFuture<?> handleStop() {
        return send(ScreenCommands.stop(device));
    }

    @Override protected ListenableFuture<?> handleRelease() {
        generation++;
        device = null;
        return Futures.immediateVoidFuture();
    }

    @Override protected ListenableFuture<?> handleSeek(int mediaItemIndex, long positionMs, int seekCommand) {
        return send(ScreenCommands.seek(device, snap, mediaItemIndex, positionMs, seekCommand));
    }

    @Override protected ListenableFuture<?> handleRemoveMediaItems(int fromIndex, int toIndex) {
        return sendAll(ScreenCommands.remove(device, snap, fromIndex, toIndex));
    }

    @Override protected ListenableFuture<?> handleMoveMediaItems(int fromIndex, int toIndex, int newIndex) {
        return send(ScreenCommands.move(device, snap, fromIndex, toIndex, newIndex));
    }

    @Override protected ListenableFuture<?> handleSetShuffleModeEnabled(boolean enabled) {
        return send(ScreenCommands.shuffle(device, enabled));
    }

    @Override protected ListenableFuture<?> handleSetRepeatMode(int repeatMode) {
        return send(ScreenCommands.repeat(device, repeatMode));
    }

    @Override protected ListenableFuture<?> handleSetDeviceVolume(int deviceVolume, int flags) {
        return send(ScreenCommands.volume(device, deviceVolume));
    }

    @Override protected ListenableFuture<?> handleIncreaseDeviceVolume(int flags) {
        return send(ScreenCommands.volume(device, Math.max(0, snap.volume) + ScreenCommands.VOLUME_STEP));
    }

    @Override protected ListenableFuture<?> handleDecreaseDeviceVolume(int flags) {
        return send(ScreenCommands.volume(device, Math.max(0, snap.volume) - ScreenCommands.VOLUME_STEP));
    }

    private ListenableFuture<?> sendAll(List<JSONObject> requests) {
        if (requests.isEmpty()) return Futures.immediateVoidFuture();
        ListenableFuture<?> last = null;
        for (JSONObject r : requests) last = send(r);
        return last;
    }

    /**
     * One command, then one read of the session; the future completes on the main thread
     * with the screen's answer applied. A reply for a screen no longer targeted is dropped.
     */
    private ListenableFuture<?> send(JSONObject request) {
        if (request == null || device == null) return Futures.immediateVoidFuture();
        SettableFuture<Void> done = SettableFuture.create();
        final long gen = generation;
        final String target = device;
        final String what = request.optString("command") + " " + request.optString("action", request.optString("op", ""));
        io.execute(() -> {
            JSONObject reply;
            try {
                reply = link.command(request);
            } catch (Exception unreachable) {
                reply = null;
            }
            ScreenSnapshot after = read(target);
            JSONObject answered = reply;
            main.post(() -> {
                if (gen == generation) {
                    noteCommand(what, answered);
                    apply(after);
                }
                done.set(null);
            });
        });
        return done;
    }

    private void noteCommand(String what, JSONObject reply) {
        String line = commandLine(reply, name);
        Log.i(TAG, "remote command " + what.trim() + " -> "
                + (reply == null ? "unreachable" : reply.optInt("status", 0) + " " + reply.optString("code", "")).trim());
        if (line.isEmpty()) return;
        commandLine = line;
        commandLineAt = SystemClock.elapsedRealtime();
    }

    /** What the status line says about one command's answer; empty when it was done. */
    static String commandLine(JSONObject reply, String screen) {
        if (reply == null || !reply.optBoolean("ok", false)) return "Can't reach home";
        if (reply.optBoolean("accepted", false)) return "";
        int status = reply.optInt("status", 0);
        String code = reply.optString("code", "");
        if (status == 409 && "IDEMPOTENCY_CONFLICT".equals(code)) return "";
        if (status == 409) return screen + " is off";
        if (status == 404) return screen + " is not on";
        return "Not confirmed by " + screen;
    }
}
