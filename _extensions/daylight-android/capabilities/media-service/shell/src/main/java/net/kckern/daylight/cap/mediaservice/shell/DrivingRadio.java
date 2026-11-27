package net.kckern.daylight.cap.mediaservice.shell;

import androidx.media3.session.MediaSession;
import net.kckern.daylight.shellkit.DrivingRadioSettings;

final class DrivingRadio {
    static final String DRIVE = "c:drive:";
    private static final String STAPLE_PREFIX = "staple:";
    private static final String ANDROID_AUTO = "com.google.android.projection.gearhead";
    private final DrivingRadioSettings settings;
    private final PayloadMedia media;

    DrivingRadio(DrivingRadioSettings settings, PayloadMedia media) {
        this.settings = settings;
        this.media = media;
    }

    static boolean isCar(MediaSession.ControllerInfo controller) {
        return ANDROID_AUTO.equals(controller.getPackageName());
    }

    boolean enabled() {
        return !settings.today().isEmpty();
    }

    String todayTitle() {
        java.util.List<String> choices = settings.today();
        if (choices.isEmpty()) return "";
        for (DrivingRadioSettings.Staple item : settings.staged()) {
            if (item.id.equals(choices.get(0))) return item.title;
        }
        return "";
    }

    /** The picture of today's playlist, which Driving Radio borrows; "" when none is known. */
    String todayArt() {
        java.util.List<String> choices = settings.today();
        return choices.isEmpty() ? "" : settings.art(choices.get(0));
    }

    private volatile long lastArtScan;
    private final java.util.concurrent.atomic.AtomicBoolean fillingArt = new java.util.concurrent.atomic.AtomicBoolean();

    /** True when a staged playlist is missing its picture. */
    boolean missingArt() {
        for (DrivingRadioSettings.Staple item : settings.staged()) {
            if (settings.isStaple(item.id) && item.art.isEmpty()) return true;
        }
        return false;
    }

    /**
     * Ask the payload for the pictures of staged playlists that have none and keep them.
     * Each saved picture changes the Drive level, which tells the car to ask again. One
     * pass at a time; a payload that is not ready or an answer that is not understood
     * just leaves the tiles as they were.
     */
    void fillMissingArt() {
        if (!missingArt()) return;
        // A playlist that no list source carries never gets a picture, so looking again on every
        // browse would rescan every source each time. Once per ten minutes is enough.
        long now = android.os.SystemClock.elapsedRealtime();
        if (lastArtScan != 0 && now - lastArtScan < 10 * 60 * 1000L) return;
        if (!fillingArt.compareAndSet(false, true)) return;
        lastArtScan = now;
        int seen = 0, saved = 0;
        try {
            org.json.JSONArray sources = new org.json.JSONObject(media.playlistSources(8000)).optJSONArray("items");
            if (sources == null) return;
            for (int s = 0; s < sources.length() && missingArt(); s++) {
                org.json.JSONObject source = sources.optJSONObject(s);
                if (source == null) continue;
                int cursor = 0;
                for (int page = 0; page < 20 && missingArt(); page++) {
                    org.json.JSONObject answer = new org.json.JSONObject(media.playlists(source.optString("id"), cursor, 8000));
                    org.json.JSONArray items = answer.optJSONArray("items");
                    if (items == null) break;
                    for (int i = 0; i < items.length(); i++) {
                        org.json.JSONObject item = items.optJSONObject(i);
                        if (item == null) continue;
                        seen++;
                        String before = settings.art(item.optString("contentId"));
                        settings.setArt(item.optString("contentId"), item.optString("thumbnail"));
                        if (!settings.art(item.optString("contentId")).equals(before)) saved++;
                    }
                    int next = answer.optInt("nextCursor", -1);
                    if (next <= cursor) break;
                    cursor = next;
                }
            }
        } catch (Throwable notNow) {
            // No payload yet, or an answer this build does not read: the tiles keep what they have.
            android.util.Log.w("Daylight-Media", "drive art: " + notNow.getClass().getSimpleName() + " " + notNow.getMessage());
        } finally {
            android.util.Log.i("Daylight-Media", "drive art: looked at " + seen + " playlists, saved " + saved);
            fillingArt.set(false);
        }
    }

    static String spokenName(String raw) {
        return raw == null ? "" : raw.toLowerCase(java.util.Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]", "");
    }

    androidx.media3.common.MediaItem exactStaple(String query) {
        String name = spokenName(query);
        if (name.isEmpty()) return null;
        androidx.media3.common.MediaItem match = null;
        for (DrivingRadioSettings.Staple item : settings.staged()) {
            if (!spokenName(item.title).equals(name)) continue;
            if (match != null) return null;
            match = NodeItems.named(STAPLE_PREFIX + item.id, item.title, false);
        }
        return match;
    }

    java.util.List<androidx.media3.common.MediaItem> staples() {
        java.util.List<androidx.media3.common.MediaItem> rows = new java.util.ArrayList<>();
        for (DrivingRadioSettings.Staple item : settings.staged()) {
            if (settings.isStaple(item.id)) rows.add(NodeItems.named(STAPLE_PREFIX + item.id, item.title, false, item.art, "Playlist"));
        }
        return rows;
    }

    /** Remember what is playing so the system can offer to resume it. Radio and staple ids are rebuilt, not stored. */
    void remember(androidx.media3.common.MediaItem item) {
        if (item == null || item.mediaId == null || item.mediaId.isEmpty()
                || item.mediaId.startsWith(STAPLE_PREFIX) || DrivingRadioSettings.MEDIA_ID.equals(item.mediaId)) return;
        androidx.media3.common.MediaMetadata m = item.mediaMetadata;
        settings.rememberLast("p:" + item.mediaId, m.title == null ? "" : m.title.toString(),
                m.subtitle == null ? "" : m.subtitle.toString(),
                m.artworkUri == null ? "" : m.artworkUri.toString(), NodeItems.longFormKind(item));
    }

    /** The last item played, as a playable node, or null when nothing has played. */
    androidx.media3.common.MediaItem last() {
        String[] last = settings.last();
        if (last == null) return null;
        androidx.media3.common.MediaMetadata.Builder meta = new androidx.media3.common.MediaMetadata.Builder()
                .setTitle(last[1].isEmpty() ? "Resume" : last[1]).setIsBrowsable(false).setIsPlayable(true);
        if (!last[2].isEmpty()) meta.setSubtitle(last[2]).setArtist(last[2]);
        if (last[3].startsWith("https://")) meta.setArtworkUri(android.net.Uri.parse(last[3]));
        return new androidx.media3.common.MediaItem.Builder().setMediaId(last[0]).setMediaMetadata(meta.build()).build();
    }

    boolean isStaple(String mediaId) {
        return mediaId.startsWith(STAPLE_PREFIX);
    }

    TrackAnswer resolveStaple(String mediaId) throws Exception {
        String id = mediaId.substring(STAPLE_PREFIX.length());
        if (!settings.isStaged(id)) throw new IllegalArgumentException("Playlist is no longer staged");
        return media.resolveShortcut("c:" + id, settings.shuffle(id), 8000);
    }

    TrackAnswer resolve() throws Exception {
        Exception lastFailure = null;
        for (String playlist : settings.today()) {
            try {
                return media.resolveShortcut("c:" + playlist, settings.shuffle(playlist), 8000);
            } catch (Exception failure) {
                lastFailure = failure;
            }
        }
        throw new IllegalStateException("Driving Radio has no playable playlist", lastFailure);
    }
}
