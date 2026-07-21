package net.kckern.portalkeys;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Iterator;

/**
 * Small in-memory ring buffer of recent events, served by `pkctl log`.
 *
 * Why this exists rather than just reading logcat: this service fails SILENTLY when
 * the accessibility grant is dropped — the buttons simply stop working. Being able to
 * ask the running app "what have you seen lately?" over LAN, with no ADB, is the
 * difference between a one-command diagnosis and a mystery.
 */
public class EventLog {

    private static final int MAX = 200;

    private final Deque<String> lines = new ArrayDeque<>();

    public synchronized void add(String line) {
        long ts = System.currentTimeMillis();
        lines.addLast(ts + " " + line);
        while (lines.size() > MAX) lines.removeFirst();
    }

    public synchronized String toJsonArray() {
        StringBuilder sb = new StringBuilder("[");
        Iterator<String> it = lines.iterator();
        boolean first = true;
        while (it.hasNext()) {
            if (!first) sb.append(",");
            sb.append("\"").append(Json.escape(it.next())).append("\"");
            first = false;
        }
        return sb.append("]").toString();
    }
}
