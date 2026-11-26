package net.kckern.daylight.cap.mediaservice;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.function.Predicate;

/**
 * Playback positions kept on disk, the newest report per content id: the ones not yet sent
 * (no network: a kept book in the car) go out when home answers, and the last one heard for
 * each item is where an offline play resumes. Plain java.io; thread-safe.
 *
 * <p>Never loses a place: the file is written beside and renamed (with an fsync), so a crash
 * leaves the old file or the new one; a file that cannot be read is set aside, not
 * overwritten. Past {@link #MAX} items, the one heard longest ago goes first, and never one
 * whose item is still kept on the phone (a long book is not pushed out by songs).
 */
final class PendingProgress {
    static final int MAX = 200;
    private final File file;
    private final Predicate<String> stillKept;

    PendingProgress(File file) { this(file, id -> false); }

    PendingProgress(File file, Predicate<String> stillKept) {
        this.file = file;
        this.stillKept = stillKept;
    }

    /** Keeps {@code body} (a play/log body); a newer report for the same content replaces it. */
    synchronized void keep(JSONObject body) {
        String id = body.optString("assetId", "");
        if (id.isEmpty()) return;
        JSONObject all = read();
        if (all == null) return;   // unreadable and could not be set aside: change nothing
        try {
            JSONObject before = all.optJSONObject(id);
            // A report heard earlier than the one held never replaces it (replays arrive out of order).
            if (before != null && before.optLong("observedAt", 0) > body.optLong("observedAt", 0)
                    && body.optLong("observedAt", 0) > 0) return;
            all.put(id, body);
            while (all.length() > MAX) {
                String drop = oldestDroppable(all);
                if (drop == null) break;   // every item is still kept: none is pushed out
                all.remove(drop);
            }
            write(all);
        } catch (Exception notKept) { /* the next report carries a later position */ }
    }

    /** A report was sent: the pending one for that content is no longer needed. */
    synchronized void sent(String contentId) {
        JSONObject all = read();
        if (all != null && all.remove(contentId) != null) { try { write(all); } catch (Exception ignored) { } }
    }

    synchronized JSONObject get(String contentId) {
        JSONObject all = read();
        return all == null ? null : all.optJSONObject(contentId);
    }

    /** Oldest heard first, so home sees them in the order they happened. */
    synchronized List<JSONObject> waiting() {
        List<JSONObject> out = new ArrayList<>();
        JSONObject all = read();
        if (all == null) return out;
        for (Iterator<String> k = all.keys(); k.hasNext(); ) {
            JSONObject b = all.optJSONObject(k.next());
            if (b != null) out.add(b);
        }
        out.sort((x, y) -> Long.compare(x.optLong("observedAt", 0), y.optLong("observedAt", 0)));
        return out;
    }

    private String oldestDroppable(JSONObject all) {
        String oldest = null;
        long at = Long.MAX_VALUE;
        for (Iterator<String> k = all.keys(); k.hasNext(); ) {
            String id = k.next();
            if (stillKept.test(id)) continue;
            JSONObject b = all.optJSONObject(id);
            long when = b == null ? 0 : b.optLong("observedAt", 0);
            if (when < at) { at = when; oldest = id; }
        }
        return oldest;
    }

    /** The positions, or null when the file exists, cannot be read and could not be set aside. */
    private JSONObject read() {
        if (!file.isFile()) return new JSONObject();
        try {
            return new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
        } catch (Exception unreadable) {
            File aside = new File(file.getParentFile(), file.getName() + ".unreadable-" + System.currentTimeMillis());
            return file.renameTo(aside) ? new JSONObject() : null;
        }
    }

    /** Written beside, synced, then renamed: a crash leaves the old file or the new one, never half of one. */
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
