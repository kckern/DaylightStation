package net.kckern.daylight.cap.mediaservice;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;

/**
 * Which kept collections are wholly on the phone, from the index the shell writes beside its
 * downloads ({@code files/kept-index.json}: {items: [{contentId, state, done, total}]}), read
 * the way the shell's own KeptIndex.onPhone does (the payload is replaceable code and cannot
 * call the shell). Ready plays offline; a part still downloading or a damaged file does not.
 */
final class KeptReady {
    static final String FILE = "kept-index.json";

    private KeptReady() { }

    static List<JSONObject> read(File filesDir) {
        List<JSONObject> out = new ArrayList<>();
        try {
            File f = new File(filesDir, FILE);
            if (!f.isFile()) return out;
            JSONArray a = new JSONObject(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8)).optJSONArray("items");
            for (int i = 0; a != null && i < a.length(); i++) if (a.optJSONObject(i) != null) out.add(a.optJSONObject(i));
        } catch (Exception unreadable) { /* nothing is ready that cannot be read */ }
        return out;
    }

    /** Whether the whole collection {@code contentId} is on the phone. */
    static boolean ready(List<JSONObject> index, String contentId) {
        for (JSONObject k : index) {
            if (!contentId.equals(k.optString("contentId"))) continue;
            String state = k.optString("state", "");
            boolean whole = !state.isEmpty() ? "ready".equals(state) : k.optInt("done") >= k.optInt("total") && k.optInt("total") > 0;
            if (whole) return true;
        }
        return false;
    }
}
