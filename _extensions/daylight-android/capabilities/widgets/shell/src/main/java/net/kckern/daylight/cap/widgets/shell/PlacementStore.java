package net.kckern.daylight.cap.widgets.shell;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Called on the Android main thread. The widget assignment and its outcome share one edit. */
final class PlacementStore {
    static final String PREFS = net.kckern.daylight.shellkit.DrivingRadioSettings.PLAYLIST_PREFS;
    private static final String REQUEST = "placement.";
    private static final String STAGED = net.kckern.daylight.shellkit.DrivingRadioSettings.STAGED;
    private static final String SHUFFLE = net.kckern.daylight.shellkit.DrivingRadioSettings.SHUFFLE;
    private static final String RECENT_PLACEMENT = "playlist_placed_at.";
    private static final String STAGING_MIGRATED = "staged_migration_v1";

    static final class StagedPlaylist {
        final String contentId;
        final String title;

        StagedPlaylist(String contentId, String title) {
            this.contentId = contentId;
            this.title = title;
        }
    }
    final SharedPreferences prefs;
    private final Context context;

    PlacementStore(Context context) {
        this.context = context;
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    LauncherPlacement begin(String contentId, String title, boolean playlist) {
        LauncherPlacement request = LauncherPlacement.pending(UUID.randomUUID().toString(), contentId, title,
                playlist, System.currentTimeMillis());
        return write(request, 0) ? request : null;
    }

    LauncherPlacement retry(LauncherPlacement previous) {
        LauncherPlacement request = previous.retry(UUID.randomUUID().toString(), System.currentTimeMillis());
        return write(request, 0) ? request : null;
    }

    LauncherPlacement get(String requestId) {
        return decode(requestId, prefs.getString(REQUEST + requestId, ""));
    }

    List<LauncherPlacement> requests() {
        List<LauncherPlacement> requests = new ArrayList<>();
        prefs.getAll().forEach((key, value) -> {
            if (!key.startsWith(REQUEST) || !(value instanceof String)) return;
            LauncherPlacement request = decode(key.substring(REQUEST.length()), (String) value);
            if (request != null) requests.add(request);
        });
        return requests;
    }

    private void migrateStaging() {
        if (prefs.getBoolean(STAGING_MIGRATED, false)) return;
        SharedPreferences.Editor edit = prefs.edit().putBoolean(STAGING_MIGRATED, true);
        requests().forEach(request -> {
            if (request.playlist && request.manualWidget == 0 && request.callbackWidget == 0)
                edit.putString(STAGED + request.contentId, request.title);
        });
        edit.apply();
    }

    List<StagedPlaylist> staged() {
        migrateStaging();
        List<StagedPlaylist> result = new ArrayList<>();
        prefs.getAll().forEach((key, value) -> {
            if (key.startsWith(STAGED) && value instanceof String)
                result.add(new StagedPlaylist(key.substring(STAGED.length()), (String) value));
        });
        result.sort(java.util.Comparator.comparing((StagedPlaylist item) -> item.title,
                String.CASE_INSENSITIVE_ORDER).thenComparing(item -> item.contentId));
        return result;
    }

    boolean isStaged(String contentId) {
        migrateStaging();
        return prefs.contains(STAGED + contentId);
    }

    boolean shuffle(String contentId) {
        return prefs.getBoolean(SHUFFLE + contentId, true);
    }

    void stage(String contentId, String title, boolean shuffle) {
        migrateStaging();
        prefs.edit().putString(STAGED + contentId, title).putBoolean(SHUFFLE + contentId, shuffle).apply();
    }

    void unstage(String contentId) {
        new net.kckern.daylight.shellkit.DrivingRadioSettings(context).setStaple(contentId, false);
        prefs.edit().remove(STAGED + contentId).apply();
    }

    List<StagedPlaylist> recentlyPlaced(List<StagedPlaylist> staged) {
        java.util.Map<String, Long> times = new java.util.HashMap<>();
        // Existing assignments predate timestamps. Their widget IDs give a stable
        // approximation until a new placement records an actual timestamp.
        prefs.getAll().forEach((key, value) -> {
            if (key.matches("button\\.\\d+\\.action") && value instanceof String
                    && ((String) value).startsWith("c:")) {
                int end = key.lastIndexOf('.');
                long legacyOrder = Long.parseLong(key.substring("button.".length(), end));
                times.merge(((String) value).substring(2), legacyOrder, Math::max);
            }
        });
        List<StagedPlaylist> recent = new ArrayList<>();
        for (StagedPlaylist item : staged) {
            long time = prefs.getLong(RECENT_PLACEMENT + item.contentId, times.getOrDefault(item.contentId, 0L));
            if (time == 0) continue;
            times.put(item.contentId, time);
            recent.add(item);
        }
        recent.sort((a, b) -> Long.compare(times.get(b.contentId), times.get(a.contentId)));
        return recent.subList(0, Math.min(4, recent.size()));
    }

    boolean assignStaged(String contentId, int widgetId) {
        if (widgetId <= 0 || !prefs.getString(ButtonFace.storeKey(widgetId), "").isEmpty()) return false;
        String title = prefs.getString(STAGED + contentId, "");
        if (title.isEmpty()) return false;
        return prefs.edit().putString(ButtonFace.storeKey(widgetId), "c:" + contentId)
                .putString(ButtonFace.storeKey(widgetId) + ".label", title)
                .putLong(RECENT_PLACEMENT + contentId, System.currentTimeMillis()).commit();
    }

    boolean write(LauncherPlacement request, int widgetId) {
        if (request == null) return false;
        request = request.updatedAt(System.currentTimeMillis());
        try {
            JSONObject record = new JSONObject()
                    .put("lineageId", request.lineageId)
                    .put("contentId", request.contentId)
                    .put("title", request.title)
                    .put("playlist", request.playlist)
                    .put("startedAt", request.startedAt)
                    .put("updatedAt", request.updatedAt)
                    .put("refused", request.refused)
                    .put("shortcutConfirmed", request.shortcutConfirmed)
                    .put("manualWidget", request.manualWidget)
                    .put("callbackWidget", request.callbackWidget);
            SharedPreferences.Editor edit = prefs.edit().putString(REQUEST + request.requestId, record.toString());
            if (widgetId > 0) {
                String key = ButtonFace.storeKey(widgetId);
                edit.putString(key, "c:" + request.contentId).putString(key + ".label", request.title)
                        .putLong(RECENT_PLACEMENT + request.contentId, System.currentTimeMillis());
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
            return new LauncherPlacement(requestId, record.optString("lineageId", requestId),
                    record.getString("contentId"), record.getString("title"), record.getBoolean("playlist"),
                    record.getLong("startedAt"), record.getLong("updatedAt"), record.getBoolean("refused"),
                    record.getBoolean("shortcutConfirmed"), record.getInt("manualWidget"), record.getInt("callbackWidget"));
        } catch (JSONException invalid) {
            return null;
        }
    }
}
