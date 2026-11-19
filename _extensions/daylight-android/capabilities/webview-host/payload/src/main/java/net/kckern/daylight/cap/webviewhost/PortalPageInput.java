package net.kckern.daylight.cap.webviewhost;

import net.kckern.daylight.core.spi.InputLock;
import org.json.JSONArray;
import org.json.JSONObject;

/** Bounded delivery to one subscribed document. A lock revision invalidates pending input. */
final class PortalPageInput {
    private String owner;
    private long revision;
    private Object target = new Object();
    private JSONArray frames = new JSONArray();

    synchronized void attach(String token) {
        if (!token.equals(owner)) { clear(); owner = token; }
    }
    synchronized void detach() { owner = null; clear(); }
    synchronized void detach(String token) { if (token.equals(owner)) detach(); }
    synchronized void clear() { target = new Object(); frames = new JSONArray(); }

    synchronized Object target(InputLock lock, BridgeTokens tokens) {
        if (owner == null || !tokens.currentTopFrame(owner) || (lock != null && lock.active())) { clear(); return null; }
        long current = lock == null ? 0 : lock.revision();
        if (current != revision) clear();
        revision = current;
        return target;
    }
    synchronized boolean offer(Object destination, JSONObject frame, InputLock lock, BridgeTokens tokens) {
        if (destination == null || destination != target(lock, tokens)) return false;
        if (frames.length() >= 128) frames = new JSONArray();
        boolean notify = frames.length() == 0;
        frames.put(frame);
        return notify;
    }
    synchronized String read(String token, InputLock lock) {
        if (!token.equals(owner)) return "";
        if (lock != null && (lock.active() || revision != lock.revision())) clear();
        String result = frames.toString();
        frames = new JSONArray();
        return result;
    }
}
