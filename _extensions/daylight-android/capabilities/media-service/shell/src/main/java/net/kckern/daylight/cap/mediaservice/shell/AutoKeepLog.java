package net.kckern.daylight.cap.mediaservice.shell;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;

/**
 * What On this phone lists about automatic keeps beside the kept rows (spec §3.10): the items
 * not kept for lack of room ("Not kept automatically: needs room") and the ones removed in the
 * last 7 days ("Removed: finished", with Keep again). One small JSON file in the app's files;
 * plain java.io, so it runs in JVM tests. Titles stay on the phone (never in telemetry).
 */
final class AutoKeepLog {
    static final String FILE = "autokeep-log.json";
    static final String SKIPPED = "skipped", REMOVED = "removed";
    static final int MAX = 50;

    private final File file;

    AutoKeepLog(File filesDir) { this.file = new File(filesDir, FILE); }

    /** Not kept for lack of room: one line per item, the newest time. */
    synchronized void skipped(String contentId, String title, long now) { put(contentId, title, SKIPPED, "", now); }

    /** Removed by these rules (finished, stale): listed 7 days with Keep again. */
    synchronized void removed(String contentId, String title, String reason, long now) { put(contentId, title, REMOVED, reason, now); }

    /** Kept again (by hand or automatically): its lines go. */
    synchronized void clear(String contentId) {
        JSONArray kept = new JSONArray();
        for (JSONObject e : all()) if (!contentId.equals(e.optString("contentId"))) kept.put(e);
        write(kept);
    }

    /** The lines to show now: skips, and removals of the last 7 days, newest first. */
    synchronized List<JSONObject> shown(long now) {
        List<JSONObject> out = new ArrayList<>();
        for (JSONObject e : all()) {
            if (REMOVED.equals(e.optString("kind")) && now - KeepRules.notAfterNow(e.optLong("at"), now) > AutoKeepRules.REMOVED_SHOWN_MS) continue;
            out.add(e);
        }
        out.sort((a, b) -> Long.compare(b.optLong("at"), a.optLong("at")));
        return out;
    }

    /** The line for one item ("Not kept automatically: needs room"), or "". */
    synchronized String lineFor(String contentId, long now) {
        for (JSONObject e : shown(now)) if (contentId.equals(e.optString("contentId"))) return words(e);
        return "";
    }

    static String words(JSONObject e) {
        return SKIPPED.equals(e.optString("kind")) ? AutoKeepRules.NEEDS_ROOM : AutoKeepRules.removedWords(e.optString("reason"));
    }

    private void put(String contentId, String title, String kind, String reason, long now) {
        JSONArray out = new JSONArray();
        try {
            out.put(new JSONObject().put("contentId", contentId).put("title", title == null ? "" : title)
                    .put("kind", kind).put("reason", reason).put("at", now));
        } catch (Exception never) { return; }
        for (JSONObject e : all()) {
            if (contentId.equals(e.optString("contentId"))) continue;
            if (out.length() >= MAX) break;
            // Removals past their 7 days are dropped as the file is written.
            if (REMOVED.equals(e.optString("kind")) && now - KeepRules.notAfterNow(e.optLong("at"), now) > AutoKeepRules.REMOVED_SHOWN_MS) continue;
            out.put(e);
        }
        write(out);
    }

    private List<JSONObject> all() {
        List<JSONObject> out = new ArrayList<>();
        try {
            if (!file.isFile()) return out;
            JSONArray a = new JSONArray(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
            for (int i = 0; i < a.length(); i++) if (a.optJSONObject(i) != null) out.add(a.optJSONObject(i));
        } catch (Exception unreadable) { /* nothing to list */ }
        return out;
    }

    private void write(JSONArray a) {
        try {
            File tmp = new File(file.getParentFile(), FILE + ".tmp");
            Files.write(tmp.toPath(), a.toString().getBytes(StandardCharsets.UTF_8));
            if (!tmp.renameTo(file)) Files.write(file.toPath(), a.toString().getBytes(StandardCharsets.UTF_8));
        } catch (Exception notWritten) { /* shown again at the next change */ }
    }
}
