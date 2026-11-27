package net.kckern.daylight.cap.mediaservice.shell;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

/**
 * The last answer each screen gave about its session, kept with the time it was read, so
 * a screen picked a moment after the picker showed it playing opens on what it plays
 * (greyed until its first read) instead of "Nothing playing · Connecting…". Written by
 * the picker's checks and by the remote's own reads; read when a screen is chosen. On
 * this phone only, in the remote's preferences.
 *
 * <p>An answer older than {@link #KEEP_MS} is not shown: what a screen did half an hour
 * ago says nothing about now.
 */
final class ScreenMemory {
    static final long KEEP_MS = 30 * 60_000L;
    private static final String KEY = "snap.";

    /** A remembered answer: the payload's screen-session reply and when it was read (wall clock). */
    static final class Record {
        final JSONObject reply;
        final long at;
        Record(JSONObject reply, long at) { this.reply = reply; this.at = at; }

        ScreenSnapshot snapshot() { return ScreenSnapshot.parse(reply); }

        /** The read's time on the elapsed clock, for a position carried forward from it. */
        long elapsedAt(long wallNow, long elapsedNow) { return elapsedNow - Math.max(0, wallNow - at); }
    }

    private ScreenMemory() { }

    static String encode(JSONObject reply, long at) {
        try { return new JSONObject().put("at", at).put("reply", reply).toString(); }
        catch (Exception unwritable) { return null; }
    }

    static Record decode(String stored) {
        if (stored == null || stored.isEmpty()) return null;
        try {
            JSONObject o = new JSONObject(stored);
            JSONObject reply = o.optJSONObject("reply");
            return reply == null ? null : new Record(reply, o.optLong("at", 0));
        } catch (Exception unreadable) {
            return null;
        }
    }

    /** Worth showing: read within KEEP_MS (a time ahead of now by more than a minute is a clock that moved). */
    static boolean fresh(long at, long now) {
        return at > 0 && now - at < KEEP_MS && at - now < 60_000;
    }

    /** Only an answer about the screen itself is kept; "can't reach home" says nothing of it. */
    static boolean worthKeeping(JSONObject reply) {
        return reply != null && !ScreenSnapshot.parse(reply).failed();
    }

    static void remember(Context c, String device, JSONObject reply) {
        if (device == null || !worthKeeping(reply)) return;
        String s = encode(reply, System.currentTimeMillis());
        if (s != null) prefs(c).edit().putString(KEY + device, s).apply();
    }

    /** The fresh remembered answer for {@code device}, or null. */
    static Record recall(Context c, String device) {
        if (device == null) return null;
        Record r = decode(prefs(c).getString(KEY + device, null));
        return r != null && fresh(r.at, System.currentTimeMillis()) ? r : null;
    }

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(RemoteControlService.PREFS, Context.MODE_PRIVATE);
    }
}
