package net.kckern.daylight.cap.mediaservice;

import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

/**
 * Playback progress that could not be sent (no network: a downloaded book in the car):
 * kept on disk, the newest report per content id, and sent when the backend answers again,
 * so listening offline still moves the place on the server. Plain java.io; thread-safe.
 */
final class PendingProgress {
    static final int MAX = 200;
    private final File file;

    PendingProgress(File file) { this.file = file; }

    /** Keeps {@code body} (a play/log body) for later; a newer report for the same content replaces it. */
    synchronized void keep(JSONObject body) {
        String id = body.optString("assetId", "");
        if (id.isEmpty()) return;
        JSONObject all = read();
        try {
            all.put(id, body);
            while (all.length() > MAX) {
                Iterator<String> keys = all.keys();
                all.remove(keys.next());
            }
            write(all);
        } catch (Exception notKept) { /* the next report carries a later position */ }
    }

    /** A newer report was sent: an older pending one for that content is no longer needed. */
    synchronized void sent(String contentId) {
        JSONObject all = read();
        if (all.remove(contentId) != null) { try { write(all); } catch (Exception ignored) { } }
    }

    synchronized List<JSONObject> waiting() {
        List<JSONObject> out = new ArrayList<>();
        JSONObject all = read();
        for (Iterator<String> k = all.keys(); k.hasNext(); ) {
            JSONObject b = all.optJSONObject(k.next());
            if (b != null) out.add(b);
        }
        // Oldest heard first, so the backend sees them in the order they happened.
        out.sort((x, y) -> Long.compare(x.optLong("observedAt", 0), y.optLong("observedAt", 0)));
        return out;
    }

    private JSONObject read() {
        try { return file.isFile() ? new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8)) : new JSONObject(); }
        catch (Exception unreadable) { return new JSONObject(); }
    }

    private void write(JSONObject all) throws Exception {
        File dir = file.getParentFile();
        if (dir != null) //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        Files.write(file.toPath(), all.toString().getBytes(StandardCharsets.UTF_8));
    }
}
