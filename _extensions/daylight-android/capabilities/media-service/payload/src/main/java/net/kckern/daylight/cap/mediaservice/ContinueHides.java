package net.kckern.daylight.cap.mediaservice;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

/**
 * "Remove from Continue listening" on this phone (ops:docs/superpowers/specs/2026-11-26-phone-lookup-and-browse.md
 * §10). The hide is home's (one truth for every device and the web: the household's removed
 * list, with its time); this file holds what the phone has asked and home has not yet heard,
 * so the card stays gone offline and the request goes out when home answers, like a
 * progress report. A hide home has taken is dropped from here: home's own Continue answer
 * leaves it out from then on, and brings it back when it is played after the hide. An Undo
 * before home heard the hide simply forgets it. Plain java.io; thread-safe.
 */
final class ContinueHides {
    static final int MAX = 200;
    private final File file;

    ContinueHides(File file) { this.file = file; }

    /** Hidden on this phone at {@code nowMs}; to be sent. */
    synchronized void hide(String contentId, long nowMs) {
        if (!ContentId.valid(contentId)) return;
        JSONObject all = read();
        try {
            all.put(contentId, new JSONObject().put("op", "hide").put("at", nowMs));
            while (all.length() > MAX) all.remove(oldest(all));
            write(all);
        } catch (Exception notKept) { /* the card still went; home is asked on the next try */ }
    }

    /** Undo: a hide home has not heard is forgotten; one it has is to be taken back. */
    synchronized void unhide(String contentId, long nowMs) {
        if (!ContentId.valid(contentId)) return;
        JSONObject all = read();
        try {
            JSONObject e = all.optJSONObject(contentId);
            if (e != null && "hide".equals(e.optString("op"))) all.remove(contentId);
            else all.put(contentId, new JSONObject().put("op", "unhide").put("at", nowMs));
            write(all);
        } catch (Exception notKept) { }
    }

    /** Home took the request for {@code contentId} (or refused it for good): it is no longer waiting. */
    synchronized void sent(String contentId, String op) {
        JSONObject all = read();
        JSONObject e = all.optJSONObject(contentId);
        if (e == null || !op.equals(e.optString("op"))) return;
        all.remove(contentId);
        try { write(all); } catch (Exception ignored) { }
    }

    /** The requests home has not heard, oldest first: [{contentId, op, at}]. */
    synchronized List<JSONObject> waiting() {
        List<JSONObject> out = new ArrayList<>();
        JSONObject all = read();
        for (Iterator<String> k = all.keys(); k.hasNext(); ) {
            String id = k.next();
            JSONObject e = all.optJSONObject(id);
            if (e == null) continue;
            try { out.add(new JSONObject().put("contentId", id).put("op", e.optString("op")).put("at", e.optLong("at"))); }
            catch (Exception ignored) { }
        }
        out.sort((a, b) -> Long.compare(a.optLong("at"), b.optLong("at")));
        return out;
    }

    /** Whether the phone hides {@code contentId} itself: a hide home has not heard yet. */
    synchronized boolean hiddenHere(String contentId) {
        JSONObject e = read().optJSONObject(contentId);
        return e != null && "hide".equals(e.optString("op"));
    }

    /** {@code items} (Continue listening entries, {contentId, …}) without the ones hidden here. */
    JSONArray filter(JSONArray items) {
        JSONArray out = new JSONArray();
        for (int i = 0; items != null && i < items.length(); i++) {
            JSONObject o = items.optJSONObject(i);
            if (o != null && !hiddenHere(o.optString("contentId"))) out.put(o);
        }
        return out;
    }

    private static String oldest(JSONObject all) {
        String oldest = null;
        long at = Long.MAX_VALUE;
        for (Iterator<String> k = all.keys(); k.hasNext(); ) {
            String id = k.next();
            long when = all.optJSONObject(id) == null ? 0 : all.optJSONObject(id).optLong("at");
            if (when < at) { at = when; oldest = id; }
        }
        return oldest;
    }

    private JSONObject read() {
        if (!file.isFile()) return new JSONObject();
        try { return new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8)); }
        catch (Exception unreadable) { return new JSONObject(); }
    }

    private void write(JSONObject all) throws Exception {
        File dir = file.getParentFile();
        if (dir != null) //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        File tmp = new File(dir, file.getName() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(all.toString().getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        }
        if (!tmp.renameTo(file)) throw new java.io.IOException("could not replace " + file.getName());
    }
}
