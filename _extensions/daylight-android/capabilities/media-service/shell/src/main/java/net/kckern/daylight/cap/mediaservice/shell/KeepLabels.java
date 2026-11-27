package net.kckern.daylight.cap.mediaservice.shell;

import android.content.Context;

import net.kckern.daylight.shellkit.KeptIndex;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.Collections;
import java.util.List;

/**
 * The words other screens show for automatic keeps (spec §3.10), one call each, so Now
 * playing and the book page carry the label without knowing the rules: "Playing from this
 * phone · Kept automatically", and on a book's page its state ("Kept automatically · 230 MB")
 * or why it was not ("Not kept automatically: needs room"). The kept index is read again only
 * when it changed (these are called while drawing).
 */
final class KeepLabels {
    private KeepLabels() { }

    private static List<JSONObject> index = Collections.emptyList();
    private static long indexStamp = -1;

    private static synchronized List<JSONObject> index(Context c) {
        File f = new File(c.getFilesDir(), KeptIndex.FILE);
        long stamp = f.isFile() ? f.lastModified() ^ f.length() : 0;
        if (stamp != indexStamp) { index = KeptIndex.read(c.getFilesDir()); indexStamp = stamp; }
        return index;
    }

    /** Now playing's line for a track played from its copy. */
    static String playingFromPhone(Context c, String mediaId) {
        JSONObject k = holding(index(c), mediaId);
        return k != null && k.optBoolean("auto") ? "Playing from this phone · " + KeptIndex.KEPT_AUTOMATICALLY : "Playing from this phone";
    }

    /** A collection page's line: its automatic keep's state, or why it was not kept automatically; "" otherwise. */
    static String collectionLine(Context c, String contentId) {
        if (contentId == null || contentId.isEmpty()) return "";
        for (JSONObject k : index(c)) {
            if (!contentId.equals(k.optString("contentId"))) continue;
            return k.optBoolean("auto") ? KeptIndex.describe(k) : "";
        }
        try { return KeepStore.get(c).autoLine(contentId); } catch (RuntimeException unavailable) { return ""; }
    }

    static JSONObject holding(List<JSONObject> index, String id) {
        if (id == null) return null;
        for (JSONObject k : index) {
            if (id.equals(k.optString("contentId"))) return k;
            JSONArray ids = k.optJSONArray("trackIds");
            for (int i = 0; ids != null && i < ids.length(); i++) if (id.equals(ids.optString(i))) return k;
        }
        return null;
    }
}
