package net.kckern.daylight.cap.widgets.shell;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

/** Called on the Android main thread. The widget assignment and its outcome share one edit. */
final class PlacementStore {
    static final String PREFS = "daylight_buttons";
    private static final String REQUEST = "placement.";
    private static final String MANUAL = "manual_placement";
    final SharedPreferences prefs;

    PlacementStore(Context context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    LauncherPlacement begin(String contentId, String title, boolean playlist) {
        LauncherPlacement request = LauncherPlacement.pending(UUID.randomUUID().toString(), contentId, title,
                playlist, System.currentTimeMillis());
        return write(request, 0) ? request : null;
    }

    LauncherPlacement get(String requestId) {
        return decode(requestId, prefs.getString(REQUEST + requestId, ""));
    }

    List<LauncherPlacement> recent() {
        List<LauncherPlacement> requests = new ArrayList<>();
        prefs.getAll().forEach((key, value) -> {
            if (!key.startsWith(REQUEST) || !(value instanceof String)) return;
            LauncherPlacement request = decode(key.substring(REQUEST.length()), (String) value);
            if (request != null) requests.add(request);
        });
        requests.sort(Comparator.comparingLong((LauncherPlacement request) -> request.startedAt).reversed());
        return requests;
    }

    String manualRequestId() {
        return prefs.getString(MANUAL, "");
    }

    void prepareManual(LauncherPlacement request) {
        prefs.edit().putString(MANUAL, request.requestId).apply();
    }

    boolean write(LauncherPlacement request, int widgetId) {
        if (request == null) return false;
        try {
            JSONObject record = new JSONObject()
                    .put("contentId", request.contentId)
                    .put("title", request.title)
                    .put("playlist", request.playlist)
                    .put("startedAt", request.startedAt)
                    .put("updatedAt", System.currentTimeMillis())
                    .put("refused", request.refused)
                    .put("shortcutConfirmed", request.shortcutConfirmed)
                    .put("manualWidget", request.manualWidget)
                    .put("callbackWidget", request.callbackWidget);
            SharedPreferences.Editor edit = prefs.edit().putString(REQUEST + request.requestId, record.toString());
            if (widgetId > 0) {
                String key = ButtonFace.storeKey(widgetId);
                edit.putString(key, "c:" + request.contentId).putString(key + ".label", request.title);
            }
            return edit.commit();
        } catch (JSONException invalid) {
            return false;
        }
    }

    private static LauncherPlacement decode(String requestId, String stored) {
        if (stored.isEmpty()) return null;
        try {
            JSONObject record = new JSONObject(stored);
            return new LauncherPlacement(requestId, record.getString("contentId"), record.getString("title"),
                    record.getBoolean("playlist"), record.getLong("startedAt"), record.getLong("updatedAt"),
                    record.getBoolean("refused"),
                    record.getBoolean("shortcutConfirmed"), record.getInt("manualWidget"), record.getInt("callbackWidget"));
        } catch (JSONException invalid) {
            return null;
        }
    }
}
