package net.kckern.daylight.shellkit;

import android.content.Context;
import android.content.SharedPreferences;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;

/** A legacy launcher gets a stable link for one capture action, never the general link key. */
public final class LauncherCaptureShortcut {
    public static final String PORT = "launcher-capture";
    private static final String PREFIX = "daylight://launcher-capture/";
    private static final String PREFS = "daylight_launcher_captures";

    private LauncherCaptureShortcut() { }

    public static boolean supports(String id) {
        return "journal".equals(id) || "journal-note".equals(id) || "meal".equals(id)
                || "capture-status".equals(id) || "meal-note".equals(id) || "meal-photo".equals(id) || "meal-barcode".equals(id);
    }

    public static synchronized String issue(Context context, String id) {
        if (!supports(id)) throw new IllegalArgumentException("Unknown capture shortcut");
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String token = preferences.getString(id, "");
        if (token.isEmpty()) {
            token = UUID.randomUUID().toString();
            if (!preferences.edit().putString(id, token).commit()) throw new IllegalStateException("Could not save shortcut");
        }
        return PREFIX + id + "#" + token;
    }

    public static boolean isCaptureLink(String link) { return link.startsWith(PREFIX); }

    public static String authorizedId(Context context, String link) {
        if (!isCaptureLink(link)) return null;
        int fragment = link.indexOf('#', PREFIX.length());
        if (fragment < 0) return null;
        String id = link.substring(PREFIX.length(), fragment);
        if (!supports(id)) return null;
        String token = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(id, "");
        if (token.isEmpty()) return null;
        return MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8),
                link.substring(fragment + 1).getBytes(StandardCharsets.UTF_8)) ? id : null;
    }
}
