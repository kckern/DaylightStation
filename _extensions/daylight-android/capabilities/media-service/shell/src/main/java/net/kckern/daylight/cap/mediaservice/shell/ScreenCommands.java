package net.kckern.daylight.cap.mediaservice.shell;

import androidx.media3.common.Player;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * What a Media3 player call means for a screen: one screen-command request per call,
 * in the payload's vocabulary (ScreenRemote). Pure, so a JVM test reads the mapping
 * without a Looper; ScreenPlayer only sends what is built here.
 *
 * Every request names the queue entry by its queueItemId, never by an index the
 * screen may have moved since: the snapshot the call was made against is passed in.
 */
final class ScreenCommands {
    static final int VOLUME_STEP = 5;
    static final double SEEK_STEP_S = CarControls.SEEK_STEP_MS / 1000.0;

    private ScreenCommands() {}

    static JSONObject playWhenReady(String device, boolean play) {
        return transport(device, play ? "play" : "pause");
    }

    static JSONObject stop(String device) {
        return transport(device, "stop");
    }

    /**
     * SimpleBasePlayer turns every seek-like call into (target index, position, the
     * command that asked). The command says what was meant; the index is only used to
     * pick the queue entry for a jump.
     *
     * @return null when the call asks for nothing (a jump to an entry that is gone)
     */
    static JSONObject seek(String device, ScreenSnapshot snap, int index, long positionMs, int command) {
        switch (command) {
            case Player.COMMAND_SEEK_TO_NEXT:
            case Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM:
                return transport(device, "skipNext");
            case Player.COMMAND_SEEK_TO_PREVIOUS:
            case Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM:
                return transport(device, "skipPrev");
            case Player.COMMAND_SEEK_BACK:
                return transport(device, "seekRel", -SEEK_STEP_S);
            case Player.COMMAND_SEEK_FORWARD:
                return transport(device, "seekRel", SEEK_STEP_S);
            case Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM:
                return transport(device, "seekAbs", seconds(positionMs));
            default:
                if (index == snap.current) return transport(device, "seekAbs", seconds(positionMs));
                if (index < 0 || index >= snap.entries.size()) return null;
                return with(queue(device, "jump"), "queueItemId", snap.entries.get(index).queueItemId);
        }
    }

    /** Removing every entry is a clear; otherwise one remove per entry, by id. */
    static List<JSONObject> remove(String device, ScreenSnapshot snap, int fromIndex, int toIndex) {
        List<JSONObject> out = new ArrayList<>();
        int from = Math.max(0, fromIndex), to = Math.min(snap.entries.size(), toIndex);
        if (from >= to) return out;
        if (from == 0 && to == snap.entries.size()) {
            out.add(queue(device, "clear"));
            return out;
        }
        for (int i = from; i < to; i++) {
            out.add(with(queue(device, "remove"), "queueItemId", snap.entries.get(i).queueItemId));
        }
        return out;
    }

    /** The whole new order, by id, the way Media3 describes a move. */
    static JSONObject move(String device, ScreenSnapshot snap, int fromIndex, int toIndex, int newIndex) {
        List<ScreenSnapshot.Entry> order = new ArrayList<>(snap.entries);
        int from = Math.max(0, fromIndex), to = Math.min(order.size(), toIndex);
        if (from >= to) return null;
        List<ScreenSnapshot.Entry> moved = new ArrayList<>(order.subList(from, to));
        order.subList(from, to).clear();
        int at = Math.max(0, Math.min(order.size(), newIndex));
        order.addAll(at, moved);
        JSONArray ids = new JSONArray();
        for (ScreenSnapshot.Entry e : order) ids.put(e.queueItemId);
        return with(queue(device, "reorder"), "items", ids);
    }

    static JSONObject shuffle(String device, boolean enabled) {
        return with(base(device, "shuffle"), "enabled", enabled);
    }

    static JSONObject repeat(String device, int mode) {
        String word = mode == Player.REPEAT_MODE_ONE ? "one" : mode == Player.REPEAT_MODE_ALL ? "all" : "off";
        return with(base(device, "repeat"), "mode", word);
    }

    static JSONObject volume(String device, int level) {
        return with(base(device, "volume"), "level", Math.max(0, Math.min(100, level)));
    }

    /** Media3's repeat mode for the screen's word. */
    static int repeatMode(String word) {
        if ("one".equals(word)) return Player.REPEAT_MODE_ONE;
        if ("all".equals(word)) return Player.REPEAT_MODE_ALL;
        return Player.REPEAT_MODE_OFF;
    }

    /** The player state Media3 shows for the screen's state word. */
    static int playbackState(ScreenSnapshot snap) {
        if (!snap.online() || snap.entries.isEmpty()) return Player.STATE_IDLE;
        switch (snap.state) {
            case "playing": case "paused": case "ready": return Player.STATE_READY;
            case "loading": case "buffering": case "stalled": return Player.STATE_BUFFERING;
            case "ended": return Player.STATE_ENDED;
            default: return Player.STATE_IDLE;
        }
    }

    /** Whether the screen means to be playing: what the play/pause button reflects. */
    static boolean playWhenReady(ScreenSnapshot snap) {
        if (!snap.online()) return false;
        switch (snap.state) {
            case "playing": case "loading": case "buffering": case "stalled": return true;
            default: return false;
        }
    }

    private static JSONObject transport(String device, String action) {
        return with(base(device, "transport"), "action", action);
    }

    private static JSONObject transport(String device, String action, double value) {
        try {
            return transport(device, action).put("value", value);
        } catch (JSONException finite) {
            throw new IllegalArgumentException(finite);
        }
    }

    private static JSONObject queue(String device, String op) {
        return with(base(device, "queue"), "op", op);
    }

    private static JSONObject base(String device, String command) {
        try {
            return new JSONObject().put("op", "screen-command").put("device", device).put("command", command);
        } catch (JSONException never) {
            throw new IllegalStateException(never);
        }
    }

    private static JSONObject with(JSONObject o, String key, Object value) {
        try {
            return o.put(key, value);
        } catch (JSONException finite) {
            throw new IllegalArgumentException(finite);
        }
    }

    private static double seconds(long ms) {
        return Math.max(0, ms) / 1000.0;
    }
}
