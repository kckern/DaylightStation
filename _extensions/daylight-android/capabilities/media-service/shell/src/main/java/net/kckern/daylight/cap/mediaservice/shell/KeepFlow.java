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

    static void start(Activity a, String mediaId) {
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
