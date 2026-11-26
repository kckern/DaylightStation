package net.kckern.daylight.cap.mediaservice;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * The lists this phone played lately (a playlist, an album, a household list, a station),
 * newest first, for the car's Continue tab beside the long items in progress: "play 80s
 * radio again" is one tap. Kept on the phone (the backend's recent list holds tracks,
 * not the lists they came from), at most MAX, the same list once.
 */
final class RecentLists {
    static final int MAX = 8;
    private final File file;

    RecentLists(File file) { this.file = file; }

    /** A list started playing. A newer play of the same list moves it to the top. */
    synchronized void record(String contentId, String title, String art, long now) {
        if (!ContentId.valid(contentId) || title == null || title.isEmpty()) return;
        JSONArray before = read();
        JSONArray after = new JSONArray();
        try {
            JSONObject entry = new JSONObject().put("contentId", contentId).put("title", title).put("at", now);
            if (art != null && !art.isEmpty()) entry.put("art", art);
            after.put(entry);
            for (int i = 0; i < before.length() && after.length() < MAX; i++) {
                JSONObject e = before.optJSONObject(i);
                if (e != null && !contentId.equals(e.optString("contentId"))) after.put(e);
            }
            File dir = file.getParentFile();
            if (dir != null) //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
            File tmp = new File(file.getPath() + ".tmp");
            Files.write(tmp.toPath(), after.toString().getBytes(StandardCharsets.UTF_8));
            if (!tmp.renameTo(file)) Files.write(file.toPath(), after.toString().getBytes(StandardCharsets.UTF_8));
        } catch (Exception notKept) {
            // A list not remembered is not worth failing playback over.
        }
    }

    /** Newest first. Empty when nothing was played or the file cannot be read. */
    synchronized JSONArray list() { return read(); }

    private JSONArray read() {
        try {
            return file.isFile() ? new JSONArray(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8)) : new JSONArray();
        } catch (Exception unreadable) {
            return new JSONArray();
        }
    }
}
