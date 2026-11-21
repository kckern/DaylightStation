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
            if (settings.isStaple(item.id)) rows.add(NodeItems.named(STAPLE_PREFIX + item.id, item.title, false));
        }
        return rows;
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
