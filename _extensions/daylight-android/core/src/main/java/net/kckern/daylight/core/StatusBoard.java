package net.kckern.daylight.core;

import org.json.JSONObject;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Where a capability reports its state. STATUS, HEARTBEAT and FRAME contributions
 * are written into the top level of the outgoing object, under the field names the
 * old helpers used. DIAGNOSTICS contributions get a section named after the owner.
 */
public final class StatusBoard {
    public enum Surface {
        /** GET /status. */
        STATUS,
        /** GET /diagnostics. */
        DIAGNOSTICS,
        /** The body of the outbound heartbeat. */
        HEARTBEAT,
        /** The {"type":"status"} WebSocket frame sent every second. */
        FRAME
    }

    public interface Contributor { void contribute(JSONObject into) throws Exception; }

    private static final class Entry {
        final String owner;
        final Contributor contributor;
        Entry(String owner, Contributor contributor) { this.owner = owner; this.contributor = contributor; }
    }

    private final Map<Surface, List<Entry>> entries = new EnumMap<>(Surface.class);
    private final List<Runnable> beforeHeartbeat = new CopyOnWriteArrayList<>();

    public synchronized void add(Surface surface, String owner, Contributor contributor) {
        List<Entry> list = entries.get(surface);
        if (list == null) { list = new CopyOnWriteArrayList<>(); entries.put(surface, list); }
        list.add(new Entry(owner, contributor));
    }

    public synchronized boolean has(Surface surface) {
        List<Entry> list = entries.get(surface);
        return list != null && !list.isEmpty();
    }

    public JSONObject collect(Surface surface, JSONObject base) {
        List<Entry> list;
        synchronized (this) { list = entries.get(surface); }
        if (list == null) return base;
        for (Entry e : list) {
            try {
                if (surface == Surface.DIAGNOSTICS) {
                    JSONObject section = new JSONObject();
                    e.contributor.contribute(section);
                    base.put(e.owner, section);
                } else {
                    e.contributor.contribute(base);
                }
            } catch (Throwable t) {
                try {
                    JSONObject errors = base.optJSONObject("_errors");
                    if (errors == null) { errors = new JSONObject(); base.put("_errors", errors); }
                    errors.put(e.owner, String.valueOf(t.getMessage()));
                } catch (Exception ignored) { }
            }
        }
        return base;
    }

    /** Work to do right before a heartbeat is built (the MIDI loopback probe). */
    public void beforeHeartbeat(Runnable r) { beforeHeartbeat.add(r); }

    public void runBeforeHeartbeat() {
        for (Runnable r : beforeHeartbeat) {
            try { r.run(); } catch (Throwable ignored) { }
        }
    }
}
