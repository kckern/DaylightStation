package net.kckern.portalkeys.payload;

import android.content.Context;
import android.database.ContentObserver;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import net.kckern.portalkeys.api.ShellServices;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Keeps the vendor's volume-key beep off.
 *
 * The Portal's own KeyEventAccessibilityService gets its own copy of every
 * volume key (accessibility services are not a chain) and answers with a loud
 * tone on the voice-assistant path. Removing it from
 * enabled_accessibility_services is the fix, and a reboot or vendor update puts
 * it back — the 2026-09-10 school session hit it eleven hours after a reboot.
 *
 * So the payload does the removal itself: once at start (which is every boot,
 * since the shell is START_STICKY and restarts on BOOT_COMPLETED) and again
 * whenever the setting changes under us. Our own write re-fires the observer;
 * the second pass finds nothing to remove and stops, so there is no loop.
 *
 * Removes ONLY components that mention "KeyEvent" and are not ours. The
 * Portal's presence and launcher services, and PortalKeysService itself, stay.
 */
final class VolumeBeepGuard {
    private static final String OURS = "net.kckern.portalkeys/";
    private final Context context;
    private final ShellServices shell;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private ContentObserver observer;

    VolumeBeepGuard(Context context, ShellServices shell) {
        this.context = context;
        this.shell = shell;
    }

    void start() {
        silence("start");
        Uri uri = Settings.Secure.getUriFor(Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        observer = new ContentObserver(handler) {
            @Override public void onChange(boolean selfChange) { silence("changed"); }
        };
        context.getContentResolver().registerContentObserver(uri, false, observer);
    }

    void stop() {
        if (observer != null) {
            try { context.getContentResolver().unregisterContentObserver(observer); } catch (Throwable ignored) { }
            observer = null;
        }
    }

    static boolean beeps(String component) {
        return component.contains("KeyEvent") && !component.startsWith(OURS);
    }

    /** One pass; returns what it did as JSON for the ops route and the shell log. */
    JSONObject silence(String reason) {
        JSONObject out = new JSONObject();
        try {
            String cur = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            JSONArray removed = new JSONArray();
            StringBuilder kept = new StringBuilder();
            if (cur != null) {
                for (String c : cur.split(":")) {
                    if (c.isEmpty()) continue;
                    if (beeps(c)) { removed.put(c); continue; }
                    if (kept.length() > 0) kept.append(':');
                    kept.append(c);
                }
            }
            out.put("ok", true).put("reason", reason).put("removed", removed);
            if (removed.length() == 0) return out;
            boolean ok = Settings.Secure.putString(context.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, kept.toString());
            out.put("ok", ok);
            shell.note("BEEP", (ok ? "silenced " : "FAILED to silence ") + removed.length() + " volume-beep service(s) on " + reason);
        } catch (Throwable t) {
            try { out.put("ok", false).put("error", t.toString()); } catch (Throwable ignored) { }
            shell.note("BEEP", "guard error " + t);
        }
        return out;
    }
}
