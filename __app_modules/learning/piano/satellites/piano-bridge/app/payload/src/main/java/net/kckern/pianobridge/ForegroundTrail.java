package net.kckern.pianobridge;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * ForegroundTrail — turns 1 Hz window samples into "what took the kiosk" events.
 *
 * Why it exists: on 2026-10-14 a child got from the kiosk to the Play Store and
 * nothing recorded how. The page only logged that it went hidden, the foreground
 * guard polled FKB every 10 s (through a password that had gone stale), and logcat
 * had rolled over within minutes. This class is pure (no Android, no network) so the
 * rules are tested offline; {@link ForegroundWatch} feeds it from the accessibility
 * service and ships what it returns to the log store.
 *
 * Events:
 *   kiosk.foreground.left      warn  FKB → another app. Carries the trail: the windows
 *                                    that appeared over the kiosk in the seconds before.
 *   kiosk.foreground.changed   warn  one non-FKB app → another, while away.
 *   kiosk.foreground.returned  info  back to FKB, with time away and the path taken.
 *   kiosk.window.overlay       info  a non-app window appeared (shade, assistant,
 *                                    keyguard, dialog). Capped per minute.
 */
final class ForegroundTrail {

    // AccessibilityWindowInfo.TYPE_* (duplicated so this class stays Android-free).
    static final int TYPE_APPLICATION = 1;
    static final int TYPE_INPUT_METHOD = 2;
    static final int TYPE_SYSTEM = 3;
    static final int TYPE_ACCESSIBILITY_OVERLAY = 4;

    static final int MAX_OVERLAY_EVENTS_PER_MIN = 20;
    private static final int TRAIL_SIZE = 20;

    /** One window as the accessibility service reports it. */
    static final class Win {
        final int type;
        final String pkg;
        final String title;
        final boolean active;

        Win(int type, String pkg, String title, boolean active) {
            this.type = type;
            this.pkg = pkg == null ? "" : pkg;
            this.title = title == null ? "" : title;
            this.active = active;
        }

        String key() { return typeName(type) + ":" + pkg + (title.isEmpty() ? "" : "[" + title + "]"); }
    }

    /** One log-store event. */
    static final class Event {
        final String msg;
        final String level;
        final JSONObject data;

        Event(String msg, String level, JSONObject data) {
            this.msg = msg;
            this.level = level;
            this.data = data;
        }
    }

    private String front;
    private String frontTitle = "";
    private long awaySinceMs = 0;
    private final List<String> path = new ArrayList<>();
    private Set<String> overlays = new HashSet<>();
    private final ArrayDeque<String> trail = new ArrayDeque<>();
    private long overlayWindowStartMs = 0;
    private int overlayEventsInWindow = 0;

    /** The app last seen in front, or null before the first usable sample. */
    synchronized String front() { return front; }

    /** The recent window trail, oldest first (for /kiosk/foreground). */
    synchronized JSONArray trail() { return new JSONArray(trail); }

    synchronized List<Event> sample(long now, List<Win> wins) {
        List<Event> out = new ArrayList<>();
        Win app = frontApp(wins);

        Set<String> nowOverlays = new HashSet<>();
        for (Win w : wins) {
            if (w == app || w.type == TYPE_APPLICATION) continue;
            if (w.type == TYPE_INPUT_METHOD || w.type == TYPE_ACCESSIBILITY_OVERLAY) continue;
            nowOverlays.add(w.key());
        }
        for (String k : nowOverlays) {
            if (overlays.contains(k)) continue;
            remember(now, "+" + k);
            if (front != null && overlayAllowed(now)) {
                out.add(new Event("kiosk.window.overlay", "info", obj("window", k, "front", front)));
            }
        }
        for (String k : overlays) if (!nowOverlays.contains(k)) remember(now, "-" + k);
        overlays = nowOverlays;

        if (app == null) return out;                       // keyguard / screen off: not a change
        if (front == null) {                               // baseline
            front = app.pkg;
            frontTitle = app.title;
            remember(now, "front " + app.key());
            return out;
        }
        if (app.pkg.equals(front)) { frontTitle = app.title; return out; }

        String from = front;
        boolean leaving = KioskSettingsGuard.FKB_PACKAGE.equals(from);
        boolean returning = KioskSettingsGuard.FKB_PACKAGE.equals(app.pkg);
        remember(now, "front " + app.key());

        if (leaving) {
            awaySinceMs = now;
            path.clear();
            path.add(app.pkg);
            JSONObject d = obj("from", from, "to", app.pkg, "toTitle", app.title);
            put(d, "trail", new JSONArray(trail));
            put(d, "windows", keys(wins));
            out.add(new Event("kiosk.foreground.left", "warn", d));
        } else if (returning) {
            JSONObject d = obj("from", from, "fromTitle", frontTitle);
            put(d, "awayMs", awaySinceMs == 0 ? -1 : now - awaySinceMs);
            put(d, "path", new JSONArray(path));
            out.add(new Event("kiosk.foreground.returned", "info", d));
            awaySinceMs = 0;
            path.clear();
        } else {
            path.add(app.pkg);
            JSONObject d = obj("from", from, "to", app.pkg, "toTitle", app.title);
            put(d, "awayMs", awaySinceMs == 0 ? -1 : now - awaySinceMs);
            put(d, "windows", keys(wins));
            out.add(new Event("kiosk.foreground.changed", "warn", d));
        }
        front = app.pkg;
        frontTitle = app.title;
        return out;
    }

    /** The active application window, else the first application window, else null. */
    private static Win frontApp(List<Win> wins) {
        Win first = null;
        for (Win w : wins) {
            if (w.type != TYPE_APPLICATION || w.pkg.isEmpty()) continue;
            if (w.active) return w;
            if (first == null) first = w;
        }
        return first;
    }

    private boolean overlayAllowed(long now) {
        if (now - overlayWindowStartMs >= 60_000L) { overlayWindowStartMs = now; overlayEventsInWindow = 0; }
        if (overlayEventsInWindow >= MAX_OVERLAY_EVENTS_PER_MIN) return false;
        overlayEventsInWindow++;
        return true;
    }

    private void remember(long now, String what) {
        SimpleDateFormat f = new SimpleDateFormat("HH:mm:ss.SSS", Locale.US);
        trail.addLast(f.format(new Date(now)) + " " + what);
        while (trail.size() > TRAIL_SIZE) trail.removeFirst();
    }

    private static JSONArray keys(List<Win> wins) {
        JSONArray a = new JSONArray();
        for (Win w : wins) a.put(w.key());
        return a;
    }

    private static String typeName(int t) {
        switch (t) {
            case TYPE_APPLICATION: return "app";
            case TYPE_INPUT_METHOD: return "ime";
            case TYPE_SYSTEM: return "system";
            case TYPE_ACCESSIBILITY_OVERLAY: return "a11y";
            default: return "type" + t;
        }
    }

    private static JSONObject obj(String... kv) {
        JSONObject o = new JSONObject();
        for (int i = 0; i + 1 < kv.length; i += 2) put(o, kv[i], kv[i + 1]);
        return o;
    }

    private static void put(JSONObject o, String k, Object v) {
        try { o.put(k, v); } catch (Exception ignored) { }
    }
}
