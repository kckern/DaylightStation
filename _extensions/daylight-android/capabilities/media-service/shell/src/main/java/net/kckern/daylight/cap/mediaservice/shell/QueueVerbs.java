package net.kckern.daylight.cap.mediaservice.shell;

import android.app.Activity;
import android.os.SystemClock;
import android.util.Log;

import androidx.media3.common.MediaItem;

import net.kckern.daylight.cap.mediaservice.shell.QueueModel.Region;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The queue verbs as the screens call them (Browse, Now playing), each with its snackbar
 * and Undo (spec §2). In process: the media service's QueueController is read directly,
 * so the snackbar names the real place before the item has even resolved.
 */
final class QueueVerbs {
    private static final String TAG = "Daylight-Queue";
    private static final ExecutorService IO = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "Daylight-queue-verbs");
        t.setDaemon(true);
        return t;
    });

    private QueueVerbs() { }

    /**
     * Play next or Add to queue from a row's menu. False when the media service is not
     * running (the caller then adds through its controller, which starts it).
     */
    static boolean enqueue(Activity activity, String mediaId, boolean next, String name) {
        QueueController q = QueueController.live();
        if (q == null || q.model().size() == 0) return false;
        QueueModel<MediaItem> m = q.model();
        int position = next ? m.nextBlock() + 1 : m.count(Region.QUEUED) + 1;
        final boolean[] undone = { false };
        final QueueModel.Added[] added = { null };
        // The place is known now; the item lands there when it has resolved.
        QueueSnackbar.show(activity, QueueRows.added(next, position, 1, false), () -> {
            undone[0] = true;
            QueueController live = QueueController.live();
            if (added[0] != null && live != null) live.undo(added[0], next ? "next" : "end");
        });
        q.add(mediaId, next, name, () -> undone[0], a -> {
            added[0] = a;
            if (a == null && !undone[0]) QueueSnackbar.show(activity, "Could not add " + (name == null ? "it" : name), null);
        });
        return true;
    }

    // ── a new source, announced on Now playing ─────────────────────────────

    private static String noticeText;
    private static long noticeAt;

    /**
     * A tap, Play or Shuffle from a list: Now playing opens and shows "Playing … · your 4
     * queued stay" at once, with Undo. Only when something was playing before.
     */
    static void notePlay(String label) {
        QueueController q = QueueController.live();
        if (q == null || q.model().nowIndex() < 0) { noticeText = null; return; }
        noticeText = QueueRows.playing(label, q.model().count(Region.QUEUED));
        noticeAt = SystemClock.elapsedRealtime();
    }

    /** Shows the notice a list's tap left (Now playing's onResume). */
    static void showPending(Activity activity) {
        String text = noticeText;
        long at = noticeAt;
        noticeText = null;
        if (text == null || SystemClock.elapsedRealtime() - at > 3_000) return;
        QueueSnackbar.show(activity, text, () -> {
            QueueController q = QueueController.live();
            if (q != null) q.undoReplace(at);
        });
    }

    /** The source's name for a play request from a list: a track names its list; a container names itself. */
    static String label(String mediaId, String name, String pageTitle, String searchWords) {
        boolean track = mediaId != null && mediaId.startsWith("p:");
        if (!track) return name == null ? "" : name;
        if (searchWords != null && !searchWords.trim().isEmpty()) return "search: " + searchWords.trim();
        return pageTitle == null || pageTitle.isEmpty() ? (name == null ? "" : name) : pageTitle;
    }

    // ── Play on a screen (spec §7) ──────────────────────────────────────────

    /** The content a screen loads for the phone's source: its list when there is one, else the item playing. */
    static String screenContent(String sourceId, String nowMediaId) {
        String s = sourceId == null ? "" : sourceId;
        if (s.startsWith("p:") && s.indexOf('|') > 0) {
            String list = s.substring(s.indexOf('|') + 1);
            return list.startsWith("c:") ? list.substring(2) : list;
        }
        if (s.startsWith("c:")) return BrowseActivity.contentIdOf(s);
        return BrowseActivity.contentIdOf(nowMediaId);
    }

    /**
     * Moving from this phone to a screen while this phone plays: the screen gets the source
     * (its list, else the item playing) and this phone pauses with its queue as it was.
     */
    static void handOff(Activity activity, String device, PayloadMedia media) {
        QueueController q = QueueController.live();
        if (q == null || q.model().nowEntry() == null) return;
        if (!q.isPlaying()) return;
        MediaItem now = q.model().nowEntry().item;
        String sourceId = q.model().sourceId();
        boolean list = sourceId.startsWith("c:") || (sourceId.startsWith("p:") && sourceId.indexOf('|') > 0);
        String content = screenContent(sourceId, now.mediaId);
        if (content.isEmpty()) return;
        q.pause();
        q.event("queue.handoff", "with", list ? "source" : "item");
        IO.execute(() -> {
            try {
                JSONObject request = new JSONObject().put("op", "screen-command").put("device", device)
                        .put("command", "load").put(list ? "queue" : "play", content);
                if (q.model().shuffled()) request.put("shuffle", true);
                JSONObject reply = new JSONObject(media.screenCommand(request, PlayBudget.SCREEN_MS));
                Log.i(TAG, "handoff to a screen: " + (reply.optBoolean("accepted") ? "accepted" : "refused " + reply.optString("code")));
            } catch (Exception failed) {
                Log.w(TAG, "handoff to a screen failed: " + failed.getClass().getSimpleName());
            }
        });
    }
}
