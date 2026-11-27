package net.kckern.daylight.cap.mediaservice.shell;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.Map;

/**
 * "Kept automatically while you listen" (spec §3.10), the trigger: a Player.Listener on the
 * phone's own player. It counts the minutes a long item (a book, a talk, a course; never
 * music, {@link AutoKeepRules#eligible}) plays on this phone over every sitting, and at
 * media.autoKeepAfterMin minutes asks {@link KeepStore#autoKeep} to keep it; an item resumed
 * from Continue listening on Wi-Fi is kept at once. While an automatically kept series plays
 * on, each new lecture moves its window. It also tells the store an automatic keep was played
 * (its 30 days start again) and when a book's last part was heard to the end.
 *
 * <p>Main thread only, like the player. Totals persist in "daylight.autokeep" prefs.
 */
final class AutoKeeper implements Player.Listener {
    private static final String TAG = "Daylight-Media";
    static final String PREFS = "daylight.autokeep";
    /** While playing, listening is counted and checked this often. */
    static final long TICK_MS = 30_000;
    /** The same item is asked about again at most this often (a series' window, Wi-Fi after mobile data). */
    static final long ASK_AGAIN_MS = 10 * 60_000L;
    /** Totals for items not heard in this long are forgotten. */
    private static final long FORGET_MS = 90 * AutoKeepRules.DAY_MS;

    private final Context app;
    private final Player player;
    private final SharedPreferences prefs;
    private final ListenMeter meter;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable tick = this::tick;
    private final Map<String, Long> askedAt = new HashMap<>();

    AutoKeeper(Context context, Player player) {
        this.app = context.getApplicationContext();
        this.player = player;
        this.prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.meter = new ListenMeter(new ListenMeter.Store() {
            @Override public long heardMs(String key) { return prefs.getLong("ms." + key, 0); }
            @Override public void setHeardMs(String key, long ms) {
                prefs.edit().putLong("ms." + key, ms).putLong("at." + key, System.currentTimeMillis()).apply();
            }
        });
        forgetOld();
    }

    private KeepStore store() {
        try { return KeepStore.get(app); } catch (RuntimeException broken) { return null; }
    }

    @Override public void onIsPlayingChanged(boolean playing) {
        long now = SystemClock.elapsedRealtime();
        main.removeCallbacks(tick);
        if (!playing) { meter.pause(now); return; }
        MediaItem item = player.getCurrentMediaItem();
        if (item == null) return;
        meter.play(key(item), now);
        main.postDelayed(tick, TICK_MS);
    }

    @Override public void onMediaItemTransition(MediaItem item, int reason) {
        long now = SystemClock.elapsedRealtime();
        if (item == null) { meter.pause(now); return; }
        if (player.isPlaying()) meter.play(key(item), now); else meter.pause(now);
        KeepStore store = store();
        if (store == null || !store.autoKeepOn()) return;
        String id = item.mediaId;
        // An automatically kept series moved to another lecture: its window follows.
        JSONObject held = store.keptHolding(id);
        if (held != null && held.optBoolean("auto") && held.optBoolean("series")) { ask(store, item, "window"); return; }
        if (held != null) return;   // kept already (by hand, or a book kept automatically)
        // Resumed from Continue listening, on Wi-Fi: kept at once, whatever the minutes.
        if (fromContinue(id) && eligible(item) && store.onUnmeteredNetwork()) ask(store, item, "continue");
    }

    private void tick() {
        main.removeCallbacks(tick);
        boolean playing;
        try { playing = player.isPlaying(); } catch (RuntimeException released) { playing = false; }
        if (!playing) return;
        long now = SystemClock.elapsedRealtime();
        MediaItem item = player.getCurrentMediaItem();
        if (item != null) {
            long heard = meter.step(now);
            KeepStore store = store();
            if (store != null && eligible(item)) {
                store.notePlaying(item.mediaId, player.getCurrentPosition(), duration(item));
                // Already kept (by hand, or automatically: a series' window moves on each new lecture,
                // a book kept on mobile data is completed by the Wi-Fi job): nothing to ask.
                if (store.autoKeepOn() && store.keptHolding(item.mediaId) == null
                        && AutoKeepRules.minutesReached(heard, store.autoKeepAfterMin())) ask(store, item, "minutes");
            }
        }
        main.postDelayed(tick, TICK_MS);
    }

    /** Asks the store to keep (or move the window of) the item playing, at most every 10 minutes per item. */
    private void ask(KeepStore store, MediaItem item, String trigger) {
        String id = item.mediaId;
        long now = SystemClock.elapsedRealtime();
        Long last = askedAt.get(id);
        if (last != null && now - last < ASK_AGAIN_MS) return;
        askedAt.put(id, now);
        Log.i(TAG, "keep: automatic keep asked (" + trigger + ")");
        store.autoKeep(id, NodeItems.listId(item), prefs.getLong("ms." + key(item), 0), trigger);
    }

    private boolean eligible(MediaItem item) {
        return AutoKeepRules.eligible(NodeItems.listId(item), duration(item));
    }

    private long duration(MediaItem item) {
        long playerDuration;
        try { playerDuration = item == player.getCurrentMediaItem() ? player.getDuration() : 0; }
        catch (RuntimeException released) { playerDuration = 0; }
        return NodeItems.durationMs(item, playerDuration > 0 ? playerDuration : 0);
    }

    private static String key(MediaItem item) {
        CharSequence album = item.mediaMetadata.albumTitle;
        return AutoKeepRules.itemKey(NodeItems.listId(item), album == null ? null : album.toString(), item.mediaId);
    }

    /** Whether the item is one of the Play tab's Continue listening (its last answer, kept by the Play tab). */
    private boolean fromContinue(String id) {
        try {
            String cached = app.getSharedPreferences("daylight.home", Context.MODE_PRIVATE).getString("continue", "");
            JSONArray items = cached.isEmpty() ? new JSONArray() : new JSONArray(cached);
            for (int i = 0; i < items.length(); i++) {
                JSONObject it = items.optJSONObject(i);
                if (it != null && id.equals(it.optString("contentId"))) return true;
            }
        } catch (Exception unreadable) { /* not from Continue */ }
        return false;
    }

    private void forgetOld() {
        long now = System.currentTimeMillis();
        SharedPreferences.Editor e = prefs.edit();
        for (Map.Entry<String, ?> entry : prefs.getAll().entrySet()) {
            if (!entry.getKey().startsWith("at.") || !(entry.getValue() instanceof Long)) continue;
            if (now - (Long) entry.getValue() > FORGET_MS) {
                String k = entry.getKey().substring(3);
                e.remove("at." + k).remove("ms." + k);
            }
        }
        e.apply();
    }
}
