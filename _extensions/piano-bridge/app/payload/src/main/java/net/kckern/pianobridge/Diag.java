package net.kckern.pianobridge;

import android.util.Log;

import org.json.JSONArray;

import java.util.ArrayDeque;
import java.util.Deque;

/**
 * Diag — a small in-memory ring buffer of recent events, surfaced over the
 * control server's GET /log so the pbctl CLI can diagnose the bridge externally
 * without adb/logcat (which needs READ_LOGS we can't grant). Mirrors each entry
 * to android.util.Log as well.
 */
public final class Diag {

    private static final int CAP = 200;
    private static final Deque<String> RING = new ArrayDeque<>(CAP);

    private Diag() { }

    public static synchronized void log(String tag, String msg) {
        Log.i(tag, msg);
        if (RING.size() >= CAP) RING.removeFirst();
        // Caller-relative monotonic stamp (ms since boot) keeps it timezone-free.
        RING.addLast(android.os.SystemClock.elapsedRealtime() + " [" + tag + "] " + msg);
    }

    public static synchronized JSONArray recent() {
        JSONArray a = new JSONArray();
        for (String s : RING) a.put(s);
        return a;
    }
}
