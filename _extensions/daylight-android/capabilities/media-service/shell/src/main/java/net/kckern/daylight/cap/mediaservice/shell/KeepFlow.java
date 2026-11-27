package net.kckern.daylight.cap.mediaservice.shell;

import android.app.Activity;
import android.app.AlertDialog;

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

    /** Kept for callers that do not know the title (the line then says "Checking size…"). */
    static void start(Activity a, String mediaId) { start(a, mediaId, ""); }

    /**
     * Keep {@code mediaId}, named {@code title} on every line. The keep is KeepStore's from the
     * tap (audit H12): the screen shows "Checking size of <title>… · Cancel" inline
     * ({@link KeepBar}), and leaving it never cancels the keep. A choice that needs the person
     * (a large keep, no room) is asked on the screen when it is still open, otherwise in a
     * notification; the outcome goes to the item's row and, when nothing started, a
     * notification, never only a toast.
     */
    static void start(Activity a, String mediaId, String title) {
        if (hintOnce(a, () -> start(a, mediaId, title))) return;
        if (askNotificationsOnce(a, () -> start(a, mediaId, title))) return;
        UiTelemetry.event("Downloads", "keep.tap", new JSONObject());
        KeepStore store = KeepStore.get(a);
        KeepStore.Attempt attempt = store.begin(mediaId, title);
        KeepBar.show(a, attempt);
        java.lang.ref.WeakReference<Activity> screen = new java.lang.ref.WeakReference<>(a);
        store.preview(mediaId, p -> decide(screen.get(), store, mediaId, attempt.title, p));
    }

    /** The preview's answer: asked on the screen if it is still open, else decided without it. */
    private static void decide(Activity a, KeepStore store, String mediaId, String title, JSONObject p) {
        boolean open = a != null && !a.isFinishing() && !a.isDestroyed();
        if (!p.optBoolean("ok", false)) {
            if (p.optBoolean("away", false)) {
                // Away from home: kept when home answers, and said so on the row and the line.
                store.keep(mediaId, null);
            } else {
                store.ended(mediaId, p.optString("words", "This can't be kept"), false);
            }
            return;
        }
        String named = title.isEmpty() ? p.optString("title") : title;
        if ("group".equals(p.optString("kind"))) {
            // An artist or an author: kept as a group of its albums or books, through its sheet.
            store.checked(mediaId);
            store.ended(mediaId, "Choose what to keep of " + (named.isEmpty() ? "this" : named), true);
            if (open) GroupKeepFlow.start(a, p.optString("contentId"), p.optString("groupKind"), named);
            else store.notifyOutcome(mediaId, named, "Open it to choose which albums or books to keep", null);
            return;
        }
        String what = p.optString("keep"), room = p.optString("room");
        if (!p.optBoolean("fits", true)) {
            String needs = "Needs " + net.kckern.daylight.shellkit.KeptIndex.size(p.optLong("needMore")) + " more room";
            store.checked(mediaId);
            if (!open) { store.ended(mediaId, needs + " · " + what, false); return; }
            store.ended(mediaId, needs, true);
            new AlertDialog.Builder(a, DaylightTheme.alert())
                    .setTitle(needs)
                    .setMessage(what + "\n" + room)
                    .setPositiveButton("Manage space", (d, w) -> DownloadsActivity.open(a))
                    .setNegativeButton("Cancel", null)
                    .show();
            return;
        }
        if (p.optBoolean("ask", false)) {
            store.checked(mediaId);
            if (!open) {
                store.notifyOutcome(mediaId, named, what + " · " + room, "Keep");
                store.ended(mediaId, "Keep " + (named.isEmpty() ? "it" : named) + "? Answer in the notification", true);
                return;
            }
            new AlertDialog.Builder(a, DaylightTheme.alert())
                    .setTitle(what)
                    .setMessage(room)
                    .setPositiveButton("Keep", (d, w) -> store.keep(mediaId, null))
                    .setNegativeButton("Cancel", (d, w) -> store.cancel(mediaId))
                    .setOnCancelListener(d -> store.cancel(mediaId))
                    .show();
            return;
        }
        store.keep(mediaId, null);
    }

    /**
     * Once, at the first keep: Android 13+ shows a download's progress and outcome only with
     * the notification permission, which until now only the recorder asked for (audit).
     */
    private static boolean askNotificationsOnce(Activity a, Runnable then) {
        if (android.os.Build.VERSION.SDK_INT < 33) return false;
        if (a.checkSelfPermission("android.permission.POST_NOTIFICATIONS") == android.content.pm.PackageManager.PERMISSION_GRANTED) return false;
        android.content.SharedPreferences p = a.getSharedPreferences("daylight.keep", Activity.MODE_PRIVATE);
        if (p.getBoolean("notifyAsked", false)) return false;
        p.edit().putBoolean("notifyAsked", true).apply();
        UiTelemetry.event("Downloads", "keep.notifications_asked", new JSONObject());
        new AlertDialog.Builder(a, DaylightTheme.alert())
                .setTitle("Allow notifications")
                .setMessage("A keep downloads in the background. With notifications on, the phone shows how far it is "
                        + "and tells you when it is ready or why it waits.")
                .setPositiveButton("Allow", (d, w) -> {
                    a.requestPermissions(new String[] { "android.permission.POST_NOTIFICATIONS" }, 7_211);
                    then.run();
                })
                .setNegativeButton("Not now", (d, w) -> then.run())
                .setOnCancelListener(d -> then.run())
                .show();
        return true;
    }
}
