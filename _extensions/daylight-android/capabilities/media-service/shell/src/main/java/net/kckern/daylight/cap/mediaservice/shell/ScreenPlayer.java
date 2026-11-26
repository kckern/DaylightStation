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
import androidx.media3.common.Timeline;

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
    /**
     * Failed reads in a row that keep the last good answer on show (greyed: no commands)
     * before it is replaced. One VPN blip must not empty the remote, drop the notification
     * and let the service stop while the TV plays on.
     */
    static final int MISS_LIMIT = 3;
    /** ...and for at least this long, so a 1 s watch poll does not use up MISS_LIMIT in 3 s. */
    static final long MISS_KEEP_MS = 20_000;
    /** A command still waiting this long is not sent: a late pause or skip is worse than none. */
    static final long STALE_COMMAND_MS = 5000;

    /** The payload's screen ops. Called on io, never on the main thread. */
    interface Link {
        JSONObject session(String device) throws Exception;
        JSONObject command(JSONObject request) throws Exception;
    }

    /** The line under the controls changed ("Office Screen is off", "Paused by Phone"). */
    interface Status { void changed(String line); }

    private final Handler main;
    private final Executor reads;
    /** One command at a time, in tap order. Separate from reads, so a slow read never delays a tap. */
    private final Executor commandsOut;
    /** Per kind (play/pause, volume), the newest command; an older one still waiting is dropped. */
    private final java.util.concurrent.ConcurrentHashMap<String, Long> newest = new java.util.concurrent.ConcurrentHashMap<>();
    private final java.util.concurrent.atomic.AtomicLong sequence = new java.util.concurrent.atomic.AtomicLong();
    private final Link link;
    private final Status status;

    private String device;
    private String name = "";
    private ScreenSnapshot snap = ScreenSnapshot.unreachable();
    private long snapAt;
    /** The screen says it plays but its position has not moved between two answers. */
    private boolean stalled;
    private long generation;
    private boolean reading;
    private String commandLine = "";
    private long commandLineAt;
    private String shownLine;
    /** Failed reads in a row; while 1..MISS_LIMIT-1 the last good answer stays, without commands. */
    private int misses;
    private long firstMissAt;
    private String missLine = "";

    ScreenPlayer(Looper looper, Executor reads, Executor commands, Link link, Status status) {
        super(looper);
        this.main = new Handler(looper);
        this.reads = reads;
        this.commandsOut = commands;
        this.link = link;
        this.status = status;
    }

    /** Points the player at a screen. The previous screen's answers still in flight are dropped. */
    void setScreen(String device, String name) {
        if (device != null && device.equals(this.device)) {
            // The same screen, perhaps with its real name now (the list loaded after the pick).
            if (name != null && !name.isEmpty() && !name.equals(device) && !name.equals(this.name)) {
                this.name = name;
                invalidateState();
                shownLine = null;
                publishStatus();
            }
            refresh();
            return;
        }
        generation++;
        this.device = device;
        this.name = name == null || name.isEmpty() ? String.valueOf(device) : name;
        snap = ScreenSnapshot.unreachable();
        snapAt = SystemClock.elapsedRealtime();
        reading = false;
        commandLine = "";
        misses = 0;
        missLine = "";
        Log.i(TAG, "remote screen " + device);
        invalidateState();
        // Not the previous screen's line: say what is happening until this one answers.
        shownLine = null;
        status.changed("Connecting to " + this.name + "…");
        shownLine = "Connecting to " + this.name + "…";
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
        reads.execute(() -> {
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
        } catch (net.kckern.daylight.api.PayloadPort.NotReadyException starting) {
            return ScreenSnapshot.unreachable("Daylight is starting");
        } catch (Exception unreachable) {
            return ScreenSnapshot.unreachable();
        }
    }

    private void apply(ScreenSnapshot answer) {
        if (answer.failed()) {
            if (misses == 0) firstMissAt = SystemClock.elapsedRealtime();
            misses++;
            missLine = answer.statusLine(name);
            boolean keep = misses < MISS_LIMIT || SystemClock.elapsedRealtime() - firstMissAt < MISS_KEEP_MS;
            if (keep && !snap.failed() && snap.reach != ScreenSnapshot.Reach.NOT_ON && device != null) {
                // Keep showing what the screen last said; commands wait until it answers again.
                Log.w(TAG, "remote read failed " + misses + "/" + MISS_LIMIT + ", keeping the last answer");
                invalidateState();
                publishStatus();
                return;
            }
        } else {
            misses = 0;
            missLine = "";
        }
        ScreenSnapshot.Entry before = snap.currentEntry(), now = answer.currentEntry();
        stalled = "playing".equals(answer.state) && "playing".equals(snap.state) && before != null && now != null
                && before.queueItemId.equals(now.queueItemId) && answer.positionMs == snap.positionMs;
        snap = answer;
        snapAt = SystemClock.elapsedRealtime();
        invalidateState();
        publishStatus();
    }

    /** What the screen is doing now (idle, off, …): the player shows a different stage for each. */
    ScreenSnapshot.Reach reach() { return snap.reach; }

    private void publishStatus() {
        String line = misses > 0 && !missLine.isEmpty() ? missLine
                : !commandLine.isEmpty() && SystemClock.elapsedRealtime() - commandLineAt < COMMAND_LINE_MS
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
        // Carried forward only while the screen's own reports move; a screen stuck at one
        // position is shown stuck, not ticking up and snapping back at every answer.
        boolean moving = "playing".equals(snap.state) && snap.online() && !stalled;
        if (moving) at += SystemClock.elapsedRealtime() - snapAt;
        ScreenSnapshot.Entry current = snap.currentEntry();
        if (current != null && current.durationMs > 0) at = Math.min(at, current.durationMs);
        return moving ? PositionSupplier.getExtrapolating(at, 1f) : PositionSupplier.getConstant(at);
    }

    /** What the screen can be asked now: the declared capabilities of this target. */
    private Commands commands() {
        Commands.Builder c = new Commands.Builder().addAll(
                COMMAND_GET_CURRENT_MEDIA_ITEM, COMMAND_GET_TIMELINE, COMMAND_GET_METADATA, COMMAND_GET_DEVICE_VOLUME);
        // While reads are failing, the last answer is shown but nothing is offered to send.
        if (device == null || !snap.online() || misses > 0) return c.build();
        // A volume the screen did not report is not guessed: a key press would set it from 0.
        if (snap.volume >= 0) {
            c.addAll(COMMAND_SET_DEVICE_VOLUME, COMMAND_ADJUST_DEVICE_VOLUME,
                    COMMAND_SET_DEVICE_VOLUME_WITH_FLAGS, COMMAND_ADJUST_DEVICE_VOLUME_WITH_FLAGS);
        }
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
        return send(ScreenCommands.playWhenReady(device, playWhenReady), "play-pause");
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
        return send(ScreenCommands.seek(device, shownIds(), getCurrentMediaItemIndex(), mediaItemIndex, positionMs, seekCommand));
    }

    @Override protected ListenableFuture<?> handleRemoveMediaItems(int fromIndex, int toIndex) {
        return sendAll(ScreenCommands.remove(device, shownIds(), fromIndex, toIndex));
    }

    @Override protected ListenableFuture<?> handleMoveMediaItems(int fromIndex, int toIndex, int newIndex) {
        return send(ScreenCommands.move(device, shownIds(), fromIndex, toIndex, newIndex));
    }

    @Override protected ListenableFuture<?> handleSetShuffleModeEnabled(boolean enabled) {
        return send(ScreenCommands.shuffle(device, enabled));
    }

    @Override protected ListenableFuture<?> handleSetRepeatMode(int repeatMode) {
        return send(ScreenCommands.repeat(device, repeatMode));
    }

    @Override protected ListenableFuture<?> handleSetDeviceVolume(int deviceVolume, int flags) {
        return send(ScreenCommands.volume(device, deviceVolume), "volume");
    }

    @Override protected ListenableFuture<?> handleIncreaseDeviceVolume(int flags) {
        // From what is shown (it already carries earlier presses), not the last answer.
        return send(ScreenCommands.volume(device, getDeviceVolume() + ScreenCommands.VOLUME_STEP), "volume");
    }

    @Override protected ListenableFuture<?> handleDecreaseDeviceVolume(int flags) {
        return send(ScreenCommands.volume(device, getDeviceVolume() - ScreenCommands.VOLUME_STEP), "volume");
    }

    /**
     * The queue ids in the order the controller shows them: the list a tapped index means.
     * Media3 calls a handler before it applies its placeholder, so this is what the person
     * saw, not the latest answer (which may have moved) nor an earlier one.
     */
    private List<String> shownIds() {
        Timeline timeline = getCurrentTimeline();
        List<String> ids = new java.util.ArrayList<>(timeline.getWindowCount());
        Timeline.Window window = new Timeline.Window();
        for (int i = 0; i < timeline.getWindowCount(); i++) ids.add(String.valueOf(timeline.getWindow(i, window).uid));
        return ids;
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
        return send(request, null);
    }

    /**
     * @param kind commands of one kind supersede each other (play/pause, volume): of several
     *             still waiting, only the newest is sent. Null: every one is sent, in order.
     */
    private ListenableFuture<?> send(JSONObject request, String kind) {
        if (request == null || device == null) return Futures.immediateVoidFuture();
        SettableFuture<Void> done = SettableFuture.create();
        final long gen = generation;
        final String target = device;
        final String what = request.optString("command") + " " + request.optString("action", request.optString("queueOp", ""));
        final long mine = sequence.incrementAndGet();
        final long queuedAt = SystemClock.elapsedRealtime();
        if (kind != null) newest.put(kind, mine);
        commandsOut.execute(() -> {
            boolean superseded = kind != null && newest.getOrDefault(kind, mine) != mine;
            boolean stale = SystemClock.elapsedRealtime() - queuedAt > STALE_COMMAND_MS;
            if (superseded || stale) {
                Log.i(TAG, "remote command " + what.trim() + " not sent: " + (superseded ? "superseded" : "waited too long"));
                main.post(() -> {
                    if (stale && !superseded && gen == generation) {
                        commandLine = "Too slow to send; try again";
                        commandLineAt = SystemClock.elapsedRealtime();
                        publishStatus();
                    }
                    done.set(null);
                });
                return;
            }
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
        if (reply == null || "unreachable".equals(reply.optString("error"))) return "Can't reach home";
        if (!reply.optBoolean("ok", false)) return "Could not send that to " + screen;
        if (reply.optBoolean("accepted", false)) return "";
        if ("no_answer".equals(reply.optString("code"))) return screen + " did not answer in time; it may still happen";
        int status = reply.optInt("status", 0);
        String code = reply.optString("code", "");
        if (status == 409 && "IDEMPOTENCY_CONFLICT".equals(code)) return "";
        if (status == 409) return screen + " is off";
        // DEVICE_NOT_FOUND is a screen not heard from; any other 404 is a route this
        // backend does not have yet (a newer phone than server).
        if (status == 404) return "DEVICE_NOT_FOUND".equals(code) ? screen + " is not on" : "Home needs an update for this";
        return "Not confirmed by " + screen;
    }
}
