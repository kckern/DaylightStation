package net.kckern.daylight.cap.mediaservice.shell;

import android.app.Activity;
import android.app.AlertDialog;
import android.widget.Toast;

import net.kckern.daylight.shellkit.DaylightTheme;
import net.kckern.daylight.shellkit.UiTelemetry;

import org.json.JSONObject;

/**
 * The one Keep flow, from every place Keep appears (Now playing's ⋮, the Play tab's Continue
 * cards and playlist tiles, On this phone): what Keep keeps ("Keep the book · 14 parts"),
 * its size and the room left ("1.2 GB · 13.8 GB left · on Wi-Fi") before anything
 * downloads; one confirmation above a quarter of the limit or of the free space; "Needs
 * 1.2 GB more room" with Manage space when it does not fit; "Waiting for home" when home is
 * away. Never a stray track: a track keeps its album, a list keeps the list.
 */
final class KeepFlow {
    private KeepFlow() { }

    /** Android stops this app in the background (battery "Restricted"): downloads cannot run with it closed. */
    static boolean backgroundRestricted(Activity a) {
        try {
            android.app.ActivityManager am = (android.app.ActivityManager) a.getSystemService(Activity.ACTIVITY_SERVICE);
            return android.os.Build.VERSION.SDK_INT >= 28 && am.isBackgroundRestricted();
        } catch (RuntimeException unknown) { return false; }
    }

    /** The app's own settings page (Battery → Allow background use is one tap from there). */
    static void openBatterySettings(Activity a) {
        try {
            a.startActivity(new android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    android.net.Uri.fromParts("package", a.getPackageName(), null)));
        } catch (RuntimeException none) { /* no settings screen */ }
    }

    /** Once: when Android restricts the app in the background, say so before a keep, with the way out. */
    private static boolean hintOnce(Activity a, Runnable then) {
        android.content.SharedPreferences p = a.getSharedPreferences("daylight.keep", Activity.MODE_PRIVATE);
        if (!backgroundRestricted(a) || p.getBoolean("bgHintShown", false)) return false;
        p.edit().putBoolean("bgHintShown", true).apply();
        UiTelemetry.event("Downloads", "keep.background_restricted", new JSONObject());
        new AlertDialog.Builder(a, DaylightTheme.alert())
                .setTitle("Allow background use")
                .setMessage("Android stops this app in the background, so downloads only run while it is open. "
                        + "Allow background use in its battery settings to keep downloading with the app closed.")
                .setPositiveButton("Battery settings", (d, w) -> openBatterySettings(a))
                .setNegativeButton("Not now", (d, w) -> then.run())
                .setOnCancelListener(d -> then.run())
                .show();
        return true;
    }

    static void start(Activity a, String mediaId) {
        if (hintOnce(a, () -> start(a, mediaId))) return;
        UiTelemetry.event("Downloads", "keep.tap", new JSONObject());
        Toast.makeText(a, "Checking size…", Toast.LENGTH_SHORT).show();
        KeepStore store = KeepStore.get(a);
        store.preview(mediaId, p -> {
            if (a.isFinishing() || a.isDestroyed()) return;
            if (!p.optBoolean("ok", false)) {
                if (p.optBoolean("away", false)) {
                    // Away from home: kept when home answers, and said so.
                    store.keep(mediaId, line -> say(a, line));
                } else {
                    say(a, p.optString("words", "This can't be kept"));
                }
                return;
            }
            if ("group".equals(p.optString("kind"))) {
                // An artist or an author: kept as a group of its albums or books, through its sheet.
                GroupKeepFlow.start(a, p.optString("contentId"), p.optString("groupKind"), p.optString("title"));
                return;
            }
            String what = p.optString("keep"), room = p.optString("room");
            if (!p.optBoolean("fits", true)) {
                new AlertDialog.Builder(a, DaylightTheme.alert())
                        .setTitle("Needs " + net.kckern.daylight.shellkit.KeptIndex.size(p.optLong("needMore")) + " more room")
                        .setMessage(what + "\n" + room)
                        .setPositiveButton("Manage space", (d, w) -> DownloadsActivity.open(a))
                        .setNegativeButton("Cancel", null)
                        .show();
                return;
            }
            if (p.optBoolean("ask", false)) {
                new AlertDialog.Builder(a, DaylightTheme.alert())
                        .setTitle(what)
                        .setMessage(room)
                        .setPositiveButton("Keep", (d, w) -> store.keep(mediaId, line -> say(a, line)))
                        .setNegativeButton("Cancel", null)
                        .show();
                return;
            }
            say(a, what + " · " + room);
            store.keep(mediaId, line -> say(a, line));
        });
    }

    private static void say(Activity a, String line) {
        if (a.isFinishing() || a.isDestroyed()) return;
        Toast.makeText(a, line, Toast.LENGTH_LONG).show();
    }
}
