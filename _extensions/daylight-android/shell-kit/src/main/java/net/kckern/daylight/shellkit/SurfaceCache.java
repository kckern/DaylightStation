package net.kckern.daylight.shellkit;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;

import net.kckern.daylight.api.SurfaceKeys;

/**
 * Reads the last-known labels and links of the tiles and the widget (see
 * SurfaceKeys in shell-api for the file and its keys). The payload writes the file;
 * installed components only read it, so they draw when no payload is loaded.
 */
public final class SurfaceCache {
    private SurfaceCache() { }

    /** The stored value, or an empty string. */
    public static String get(Context context, String key) {
        SharedPreferences prefs = context.getSharedPreferences(SurfaceKeys.PREFS, Context.MODE_PRIVATE);
        if (prefs == null) return "";
        String value = prefs.getString(key, "");
        return value == null ? "" : value;
    }

    /** A stored link, or an empty string when the slot is unassigned or holds anything but a daylight:// link. */
    public static String link(Context context, String key) {
        String uri = get(context, key);
        return SurfaceKeys.launchable(uri) ? uri : "";
    }

    /**
     * The intent that opens a daylight:// link: a VIEW limited to this app's own
     * package, so it can only reach the link activity and never another app that
     * claims the scheme.
     */
    public static Intent viewIntent(Context context, String link) {
        return new Intent(Intent.ACTION_VIEW, Uri.parse(link)).setPackage(context.getPackageName());
    }
}
