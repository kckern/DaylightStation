package net.kckern.daylight.cap.mediaservice.shell;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.common.Timeline;
import androidx.media3.exoplayer.ExoPlayer;

import net.kckern.daylight.cap.mediaservice.shell.QueueModel.End;
import net.kckern.daylight.cap.mediaservice.shell.QueueModel.Region;
import net.kckern.daylight.shellkit.UiTelemetry;

import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;

/**
 * The phone's queue in the media service: QueueModel's regions kept in step with the
 * ExoPlayer, the verbs this app's screens call (in process, main thread), the end of the
 * queue (Stop, Keep playing, Repeat per kind), the offline skip, telemetry and the saved
 * copy that comes back paused after a restart. Spec:
 * ops:docs/superpowers/specs/2026-11-26-phone-queue.md.
 *
 * The model is the one writer of the player's list: everything here goes through it,
 * and a change the model did not make (none is expected) rebuilds it from the player.
 */
final class QueueController implements QueueModel.Sink<MediaItem> {
    private static final String TAG = "Daylight-Queue";
    static final String PREFS = "daylight.queue";
    private static final long SAVE_DELAY_MS = 400, POSITION_SAVE_MS = 10_000;

    /** What the service lends the queue: the car's presence, Driving Radio and its io. */
    interface Host {
        boolean carConnected();
        boolean radioAvailable();
        /** Off the main thread. */
        List<MediaItem> radio() throws Exception;
        /** Off the main thread: a container's or a track's items, in order. */
        List<MediaItem> resolve(String mediaId) throws Exception;
    }

    private static volatile QueueController live;

    /** The queue of this process's media service, or null when it is not running. Main thread. */
    static QueueController live() { return live; }

    private final Context context;
    private final ExoPlayer player;
    private final Host host;
    private final ExecutorService io;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final SharedPreferences prefs;
    private final File stateFile;
    private final QueueModel<MediaItem> model;
    private final List<Runnable> listeners = new CopyOnWriteArrayList<>();
    private Runnable modes = () -> { };
    private boolean applying;
    private int lastRev = -1;
    private QueueModel.Undo lastReplace;
    private long lastReplaceAt, undoAskedAt = -1;
    private String status = "";
    private long statusAt;
    private boolean restoring;
    private final Runnable save = this::saveNow;
    private final Runnable positionTick = this::positionTick;

    QueueController(Context context, ExoPlayer player, Host host, ExecutorService io) {
        this.context = context.getApplicationContext();
        this.player = player;
        this.host = host;
        this.io = io;
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.stateFile = new File(new File(this.context.getFilesDir(), "queue"), "state.json");
        this.model = new QueueModel<>(item -> item.mediaId, NodeItems::longFormKind, new Random());
        model.attach(this);
        player.addListener(new Player.Listener() {
            @Override public void onMediaItemTransition(MediaItem item, int reason) {
                if (!applying) moved(reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO);
            }

            @Override public void onTimelineChanged(Timeline timeline, int reason) {
                if (!applying && reason == Player.TIMELINE_CHANGE_REASON_PLAYLIST_CHANGED) checkInStep();
            }

            @Override public void onIsPlayingChanged(boolean playing) {
                main.removeCallbacks(positionTick);
                if (playing) main.postDelayed(positionTick, POSITION_SAVE_MS);
                else scheduleSave();
            }
        });
        live = this;
    }

    QueueModel<MediaItem> model() { return model; }

    void release() {
        main.removeCallbacks(save);
        main.removeCallbacks(positionTick);
        saveNow();
        if (live == this) live = null;
    }

    /** Main thread: run on every queue change (a screen redraws in place). */
    void listen(Runnable r) { listeners.add(r); }
    void unlisten(Runnable r) { listeners.remove(r); }
    void onModes(Runnable r) { modes = r == null ? () -> { } : r; }

    /** A line for the queue screen, shown for a while ("Skipped 2 that need a connection"). */
    String status() { return SystemClock.elapsedRealtime() - statusAt < 30_000 ? status : ""; }

    private void say(String line) {
        status = line;
        statusAt = SystemClock.elapsedRealtime();
        Log.i(TAG, "status: " + line);
    }

    // ── the verbs ───────────────────────────────────────────────────────────

    /**
     * Play next or Add to queue, from a row's menu. Resolves the id off the main thread,
     * then adds. {@code done} gets the result (or null) on the main thread; {@code cancelled}
     * asked before the answer came means nothing is added.
     */
    void add(String mediaId, boolean next, String label, java.util.function.BooleanSupplier cancelled,
             java.util.function.Consumer<QueueModel.Added> done) {
        io.execute(() -> {
            List<MediaItem> items;
            try { items = host.resolve(mediaId); } catch (Exception failed) { items = null; Log.w(TAG, "add: could not resolve (" + failed.getClass().getSimpleName() + ")"); }
            List<MediaItem> got = items;
            main.post(() -> {
                if (cancelled != null && cancelled.getAsBoolean()) { done.accept(null); return; }
                QueueModel.Added a = got == null || got.isEmpty() ? null : addItems(got, next, label);
                done.accept(a);
            });
        });
    }

    QueueModel.Added addItems(List<MediaItem> items, boolean next, String label) {
        QueueModel.Added a = model.add(items, next, label);
        if (a == null) return null;
        if (a.started) player.prepare();
        event("queue.add", "verb", next ? "next" : "end", "kind", NodeItems.longFormKind(items.get(0)) ? "spoken" : "music",
                "count", items.size(), "position", a.position);
        changed();
        return a;
    }

    /** From another controller: right after the playing item is Play next, else Add to queue. */
    void addFromController(int index, List<MediaItem> items) {
        if (items.isEmpty()) return;
        boolean next = index == model.nowIndex() + 1;
        addItems(items, next, items.size() > 1 ? QueueTag.defaultLabel(items.get(0)) : "");
    }

    QueueModel.Undo remove(int index) {
        Region r = index >= 0 && index < model.size() ? model.at(index).region : null;
        QueueModel.Undo u = model.remove(index);
        if (u != null) { event("queue.remove", "region", r == null ? "" : r.name().toLowerCase(java.util.Locale.ROOT)); changed(); }
        return u;
    }

    void removeFromController(int from, int to) {
        for (int i = to - 1; i >= from; i--) if (i != model.nowIndex()) model.remove(i);
        changed();
    }

    boolean move(int from, int to, Region target) {
        boolean ok = model.move(from, to, target);
        if (ok) { event("queue.move", "from", from, "to", to); changed(); }
        return ok;
    }

    QueueModel.Undo clearQueued() {
        QueueModel.Undo u = model.clearQueued();
        if (u != null) { event("queue.clear", "scope", "queued"); changed(); }
        return u;
    }

    QueueModel.Undo clearUpcoming() {
        QueueModel.Undo u = model.clearUpcoming();
        if (u != null) { event("queue.clear", "scope", "all"); changed(); }
        return u;
    }

    /** The session's clearMediaItems: the whole queue goes, the one playing too. */
    void clearEverything() {
        applying = true;
        try { player.clearMediaItems(); } finally { applying = false; }
        model.clearAll();
        event("queue.clear", "scope", "everything");
        changed();
    }

    boolean undo(QueueModel.Undo u, String verb) {
        if (u == null) return false;
        boolean ok = u.undo();
        if (ok) { event("queue.undo", "verb", verb); changed(); }
        return ok;
    }

    boolean playAgain(int historyIndex) {
        boolean ok = model.playAgain(historyIndex);
        if (ok) { player.prepare(); player.play(); changed(); }
        return ok;
    }

    boolean jump(int index) {
        boolean ok = model.jump(index);
        if (ok) { player.prepare(); player.play(); }
        return ok;
    }

    /** A queued or source row's Play next: it moves to the end of the next block. */
    boolean playNextFrom(int index) {
        if (index <= model.nowIndex() || index >= model.size()) return false;
        QueueModel.Entry<MediaItem> e = model.at(index);
        int to = model.start(Region.QUEUED) + model.nextBlock();
        if (index < to) to--;
        if (!model.move(index, to, Region.QUEUED)) return false;
        e.next = true;
        event("queue.move", "from", index, "to", to);
        changed();
        return true;
    }

    boolean isPlaying() { return player.isPlaying() || player.getPlayWhenReady(); }
    void pause() { player.pause(); }
    boolean ended() { return player.getPlaybackState() == Player.STATE_ENDED; }
    long position() { return player.getCurrentPosition(); }

    /** The end card's "Play again": the source from its start, your queued kept. */
    void playAgainFromStart() {
        List<MediaItem> all = new ArrayList<>(model.sourceAll());
        if (all.isEmpty()) return;
        MediaItem first = all.get(0);
        if (first.localConfiguration != null && first.localConfiguration.tag == null)
            all.set(0, first.buildUpon().setTag(new QueueTag(model.label(), model.sourceId(), false)).build());
        newSource(all, 0, C.TIME_UNSET);
        player.prepare();
        player.play();
    }

    void setShuffle(boolean on) {
        if (model.setShuffle(on)) { event("queue.shuffle", "on", on); modes.run(); changed(); }
    }

    void setRepeat(QueueModel.Repeat mode) {
        if (model.setRepeat(mode)) {
            event("queue.repeat", "mode", mode.name().toLowerCase(java.util.Locale.ROOT));
            modes.run();
            endCheck();
            changed();
        }
    }

    void manualSkip() {
        if (model.manualSkip()) { modes.run(); changed(); }
    }

    /** The end card's choice, remembered for this kind (music, or books and talks). */
    End end() { return QueueModel.endFor(model.kind(), prefs.getString("end." + model.kind(), null), host.carConnected()); }

    End endFor(String kind) { return QueueModel.endFor(kind, prefs.getString("end." + kind, null), host.carConnected()); }

    void setEnd(End choice) {
        prefs.edit().putString("end." + model.kind(), choice.name()).apply();
        event("queue.end", "choice", choice.name().toLowerCase(java.util.Locale.ROOT));
        endCheck();
        changed();
    }

    boolean radioAvailable() { return host.radioAvailable(); }

    // ── a new source ────────────────────────────────────────────────────────

    /**
     * A tap, Play or Shuffle (any controller): the new list replaces now playing and the
     * source; your queued stay. The previous source can be put back (Undo).
     */
    void newSource(List<MediaItem> items, int start, long positionMs) {
        if (items.isEmpty()) { clearEverything(); return; }
        int s = Math.max(0, Math.min(start, items.size() - 1));
        Object tag = items.get(s).localConfiguration == null ? null : items.get(s).localConfiguration.tag;
        QueueTag qt = tag instanceof QueueTag ? (QueueTag) tag : null;
        int kept = model.count(Region.QUEUED);
        long previous = model.nowIndex() >= 0 ? player.getCurrentPosition() : 0;
        lastReplace = model.replace(items, s, positionMs == C.TIME_UNSET ? -1 : positionMs, previous,
                qt != null ? qt.label : QueueTag.defaultLabel(items.get(s)), qt != null ? qt.sourceId : "",
                qt == null ? tag : null, qt != null && qt.shuffled);
        lastReplaceAt = SystemClock.elapsedRealtime();
        event("queue.replace", "kept", kept);
        modes.run();
        changed();
        if (undoAskedAt >= 0 && lastReplaceAt >= undoAskedAt && lastReplaceAt - undoAskedAt < 15_000) {
            // Undo was pressed before the new source arrived.
            undoAskedAt = -1;
            undoReplace(lastReplaceAt);
        }
    }

    /** The snackbar's Undo for a new source tapped at {@code tapAt} (elapsed realtime). */
    boolean undoReplace(long tapAt) {
        if (lastReplace != null && lastReplaceAt >= tapAt) {
            QueueModel.Undo u = lastReplace;
            lastReplace = null;
            boolean playing = player.getPlayWhenReady();
            boolean ok = undo(u, "replace");
            if (ok) { player.prepare(); if (playing) player.play(); }
            return ok;
        }
        undoAskedAt = tapAt;
        return true;
    }

    /** The first tap's list arrived after its track: the rest of the list becomes the source. */
    boolean splice(List<MediaItem> list, int at) {
        boolean ok = model.spliceSource(list, at);
        if (ok) changed();
        return ok;
    }

    // ── the player moved ────────────────────────────────────────────────────

    private void moved(boolean auto) {
        int from = model.nowIndex();
        int to = player.getCurrentMediaItemIndex();
        if (model.size() != player.getMediaItemCount()) { checkInStep(); return; }
        if (auto && model.pausesAt(from, to, endFor("spoken"))) {
            // A book reached its end: your queued wait for a press (the end card says so).
            player.pause();
            say("The book has finished. Your queued are next");
        }
        if (!model.onTransition(to)) return;
        skipOffline();
        endCheck();
        changed();
    }

    /** At the last item: another pass (Repeat) or radio (Keep playing), as the end choice says. */
    private void endCheck() {
        End end = end();
        if (model.wantsAnotherPass(end)) {
            model.appendPass();
            return;
        }
        if (model.wantsRadio(end) && host.radioAvailable()) fetchRadio();
    }

    private boolean fetchingRadio;

    private void fetchRadio() {
        if (fetchingRadio) return;
        fetchingRadio = true;
        final int rev = model.rev();
        final MediaItem at = player.getCurrentMediaItem();
        io.execute(() -> {
            List<MediaItem> radio;
            try { radio = host.radio(); } catch (Exception unavailable) { radio = null; Log.w(TAG, "radio: unavailable"); }
            List<MediaItem> got = radio;
            main.post(() -> {
                fetchingRadio = false;
                if (got == null || got.isEmpty() || player.getCurrentMediaItem() != at || !model.wantsRadio(end())) return;
                List<MediaItem> marked = new ArrayList<>();
                for (MediaItem m : got) {
                    if (at != null && m.mediaId.equals(at.mediaId)) continue;
                    marked.add(m);
                }
                model.appendRadio(marked);
                Log.i(TAG, "radio: " + marked.size() + " behind the queue (rev " + rev + ")");
                changed();
            });
        });
    }

    /** Offline: items that need a connection are skipped with a line, never in a loop (§7). */
    private void skipOffline() {
        if (online() || !player.getPlayWhenReady()) return;
        int now = model.nowIndex();
        if (now < 0 || playsOffline(model.at(now).item)) return;
        int skipped = 0;
        for (int i = now + 1; i < model.size(); i++) {
            skipped++;
            if (playsOffline(model.at(i).item)) {
                say("Skipped " + skipped + (skipped == 1 ? " that needs" : " that need") + " a connection");
                int target = i;
                main.post(() -> { if (player.getMediaItemCount() > target) player.seekToDefaultPosition(target); });
                return;
            }
        }
        player.pause();
        say("Nothing left here plays without a connection");
    }

    boolean playsOffline(MediaItem item) {
        try { return KeepStore.get(context).where(item.mediaId) == PlaybackRecovery.ON_PHONE; }
        catch (RuntimeException broken) { return false; }
    }

    boolean online() {
        ConnectivityManager cm = context.getSystemService(ConnectivityManager.class);
        if (cm == null) return true;
        Network n = cm.getActiveNetwork();
        NetworkCapabilities caps = n == null ? null : cm.getNetworkCapabilities(n);
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    /** A change the model did not make (another writer): rebuild the regions from the player. */
    private void checkInStep() {
        if (model.size() == player.getMediaItemCount() && model.nowIndex() == player.getCurrentMediaItemIndex()) return;
        List<MediaItem> items = new ArrayList<>();
        for (int i = 0; i < player.getMediaItemCount(); i++) items.add(player.getMediaItemAt(i));
        Log.w(TAG, "the player's list changed outside the queue; rebuilt (" + items.size() + " items)");
        model.resync(items, player.getCurrentMediaItemIndex());
        changed();
    }

    // ── Sink: the model's calls on the player ──────────────────────────────

    @Override public void add(int index, List<MediaItem> items) {
        applying = true;
        try { player.addMediaItems(index, items); } finally { applying = false; }
    }

    @Override public void move(int from, int to) {
        applying = true;
        try { player.moveMediaItem(from, to); } finally { applying = false; }
    }

    @Override public void remove(int fromIndex, int toIndexExclusive) {
        applying = true;
        try { player.removeMediaItems(fromIndex, toIndexExclusive); } finally { applying = false; }
    }

    @Override public void replace(List<MediaItem> all, int nowIndex, long positionMs) {
        applying = true;
        try {
            player.setShuffleModeEnabled(false);
            if (all.isEmpty()) player.clearMediaItems();
            else player.setMediaItems(all, nowIndex, positionMs < 0 ? C.TIME_UNSET : positionMs);
        } finally { applying = false; }
    }

    @Override public void seek(int index) {
        // Not guarded: the transition that follows is the model's own onTransition.
        player.seekToDefaultPosition(index);
    }

    @Override public void repeatOne(boolean on) {
        player.setRepeatMode(on ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF);
    }

    // ── change, save, restore ──────────────────────────────────────────────

    private void changed() {
        if (model.rev() == lastRev) return;
        lastRev = model.rev();
        scheduleSave();
        for (Runnable r : listeners) r.run();
    }

    private void scheduleSave() {
        if (restoring) return;
        main.removeCallbacks(save);
        main.postDelayed(save, SAVE_DELAY_MS);
    }

    private void positionTick() {
        saveNow();
        if (player.isPlaying()) main.postDelayed(positionTick, POSITION_SAVE_MS);
    }

    /** Main thread: the snapshot is taken here, written on io. */
    private void saveNow() {
        if (restoring) return;
        final String json;
        try { json = QueueState.encode(model, player.getCurrentPosition()).toString(); }
        catch (Exception broken) { Log.w(TAG, "save: " + broken.getClass().getSimpleName()); return; }
        final File file = stateFile;
        Runnable write = () -> QueueState.write(file, json);
        try { io.execute(write); } catch (RuntimeException stopping) { write.run(); }
    }

    /** At the session's start: the saved queue comes back paused at its place, never playing. */
    void restore() {
        if (player.getMediaItemCount() > 0) return;
        final long t0 = SystemClock.elapsedRealtime();
        restoring = true;
        io.execute(() -> {
            JSONObject saved = QueueState.read(stateFile);
            main.post(() -> {
                restoring = false;
                if (saved == null || player.getMediaItemCount() > 0 || model.size() > 0) return;
                try {
                    int n = QueueState.apply(model, saved);
                    if (n == 0) return;
                    applying = true;
                    try {
                        player.setPlayWhenReady(false);
                        player.prepare();
                    } finally { applying = false; }
                    event("queue.restore", "items", n, "ms", SystemClock.elapsedRealtime() - t0);
                    Log.i(TAG, "restored " + n + " items, paused");
                    modes.run();
                    lastRev = -1;
                    changed();
                } catch (Exception unreadable) {
                    Log.w(TAG, "restore: " + unreadable.getClass().getSimpleName());
                }
            });
        });
    }

    // ── telemetry (no titles) ──────────────────────────────────────────────

    void event(String name, Object... kv) {
        JSONObject d = new JSONObject();
        try { for (int i = 0; i + 1 < kv.length; i += 2) d.put((String) kv[i], kv[i + 1]); } catch (Exception ignored) { }
        UiTelemetry.event(context, "Queue", name, d);
        Log.i(TAG, name + " " + d);
    }
}
