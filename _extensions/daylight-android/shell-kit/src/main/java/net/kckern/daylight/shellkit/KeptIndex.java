package net.kckern.daylight.shellkit;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * What is kept on this phone, for any screen to show: each kept collection (a book, an
 * album, a playlist) with its title, cover, track ids and how far its download is (done of
 * total, bytes, failures). Written by media-service's downloads whenever they change; read
 * by the phone home's "On this phone" and Continue listening. One JSON file in the app's
 * files; plain java.io, so it runs in JVM tests.
 */
public final class KeptIndex {
    public static final String FILE = "kept-index.json";

    private KeptIndex() { }

    public static List<JSONObject> read(File filesDir) {
        List<JSONObject> out = new ArrayList<>();
        File f = new File(filesDir, FILE);
        try {
            if (!f.isFile()) return out;
            JSONArray a = new JSONObject(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8)).optJSONArray("items");
            if (a == null) return out;
            for (int i = 0; i < a.length(); i++) if (a.optJSONObject(i) != null) out.add(a.optJSONObject(i));
        } catch (Exception unreadable) { /* nothing kept that can be read */ }
        return out;
    }

    /** The download cap (MB, 0 for none) last written with the index; 4096 before any. */
    public static long capMb(File filesDir) {
        try {
            File f = new File(filesDir, FILE);
            if (!f.isFile()) return 4096;
            return new JSONObject(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8)).optLong("capMb", 4096);
        } catch (Exception unreadable) { return 4096; }
    }

    /** Bytes kept across every collection (a track two collections share counts twice: an upper bound). */
    public static long usedBytes(List<JSONObject> index) {
        long n = 0;
        for (JSONObject k : index) n += k.optLong("bytes");
        return n;
    }

    public static synchronized void write(File filesDir, JSONArray entries, long capMb) {
        try {
            String body = new JSONObject().put("capMb", capMb).put("items", entries).toString();
            File tmp = new File(filesDir, FILE + ".tmp");
            Files.write(tmp.toPath(), body.getBytes(StandardCharsets.UTF_8));
            if (!tmp.renameTo(new File(filesDir, FILE))) Files.write(new File(filesDir, FILE).toPath(), body.getBytes(StandardCharsets.UTF_8));
        } catch (Exception notWritten) { /* shown again at the next change */ }
    }

    /** Whether {@code contentId} is a track of a fully kept collection (plays without a network). */
    public static boolean onPhone(List<JSONObject> index, String contentId) {
        for (JSONObject k : index) {
            if (k.optInt("done") < k.optInt("total") || k.optInt("total") == 0) continue;
            JSONArray ids = k.optJSONArray("trackIds");
            for (int i = 0; ids != null && i < ids.length(); i++) if (contentId.equals(ids.optString(i))) return true;
            if (contentId.equals(k.optString("contentId"))) return true;
        }
        return false;
    }

    // One state per kept collection, as every screen shows it (the Play tab, Now playing's
    // menu, the notification, the web through the inbox report).
    public static final String READY = "ready", DOWNLOADING = "downloading", WAITING_WIFI = "waiting-wifi",
            WAITING_STORAGE = "waiting-storage", WAITING_HOME = "waiting-home", FAILED = "failed", REFUSED = "refused";

    /**
     * The one state of a collection: ready when every track is on the phone (and checked
     * whole); waiting for home (kept while away), Wi-Fi or storage; failed when some tracks
     * failed and nothing else is moving; otherwise downloading.
     */
    public static String stateOf(int done, int total, int failed, boolean waitingNetwork, boolean waitingStorage,
                                 boolean waitingHome) {
        if (waitingHome) return WAITING_HOME;
        if (total > 0 && done >= total) return READY;
        if (failed > 0 && done + failed >= total) return FAILED;
        if (waitingNetwork) return WAITING_WIFI;
        if (waitingStorage) return WAITING_STORAGE;
        return DOWNLOADING;
    }

    /** The inbox report's state for the web: queued | downloading | ready | failed | refused. */
    public static String reportState(String state) {
        if (WAITING_WIFI.equals(state) || WAITING_STORAGE.equals(state) || WAITING_HOME.equals(state)) return "queued";
        return state == null || state.isEmpty() ? DOWNLOADING : state;
    }

    /** "On this phone · 12 tracks · 230 MB", "Downloading 3 of 12", "2 of 12 failed: Home not reachable". */
    public static String describe(JSONObject k) {
        int done = k.optInt("done"), total = k.optInt("total"), failed = k.optInt("failed");
        String state = k.optString("state", "");
        String reason = k.optString("reason", "");
        switch (state) {
            case READY: return "On this phone · " + total + (total == 1 ? " track" : " tracks") + " · " + size(k.optLong("bytes"));
            case WAITING_HOME: return "Waiting for home";
            case WAITING_WIFI: return "Waiting for Wi-Fi · " + done + " of " + total;
            case WAITING_STORAGE: return "Waiting for storage · " + done + " of " + total;
            case FAILED: return failed + " of " + total + " failed" + (reason.isEmpty() ? "" : ": " + reason);
            case REFUSED: return "No room" + (k.optLong("needBytes") > 0 ? ": needs " + size(k.optLong("needBytes")) + " more" : "");
            case DOWNLOADING: return "Downloading " + done + " of " + total + (k.optLong("bytes") > 0 ? " · " + size(k.optLong("bytes")) : "");
            default: break;
        }
        // An index written before states (an older build).
        if (failed > 0) return failed + " of " + total + " did not download";
        if (done < total) return k.optBoolean("waiting") ? "Waiting for Wi-Fi · " + done + " of " + total : "Downloading " + done + " of " + total;
        return total + (total == 1 ? " track" : " tracks") + " · " + size(k.optLong("bytes"));
    }

    /** Whether a row offers Retry now. */
    public static boolean retryable(JSONObject k) {
        return FAILED.equals(k.optString("state")) || k.optInt("failed") > 0;
    }

    /** How far past the cap what is kept now is (bytes, 0 when within): a lowered cap deletes nothing. */
    public static long overCap(long capMb, long usedBytes) {
        return capMb <= 0 ? 0 : Math.max(0, usedBytes - capMb * 1_000_000L);
    }

    public static String size(long bytes) {
        if (bytes >= 1_000_000_000L) return String.format(Locale.US, "%.1f GB", bytes / 1e9);
        return Math.max(1, Math.round(bytes / 1e6)) + " MB";
    }

    /** Whether {@code needBytes} more fits under {@code capMb} with {@code usedBytes} already kept. */
    public static boolean fits(long capMb, long usedBytes, long needBytes) {
        return capMb <= 0 || usedBytes + Math.max(0, needBytes) <= capMb * 1_000_000L;
    }
}
