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
            // With a state, only Ready plays offline (a damaged file is not); without one (an
            // older index), every track done.
            if (!k.optString("state", "").isEmpty() ? !READY.equals(k.optString("state"))
                    : k.optInt("done") < k.optInt("total") || k.optInt("total") == 0) continue;
            JSONArray ids = k.optJSONArray("trackIds");
            for (int i = 0; ids != null && i < ids.length(); i++) if (contentId.equals(ids.optString(i))) return true;
            if (contentId.equals(k.optString("contentId"))) return true;
        }
        return false;
    }

    // One state machine for a kept item, the same words everywhere (the Play tab, On this
    // phone, Now playing, the notification, the web through the inbox report). The words are
    // the spec's (ops:docs/superpowers/specs/2026-11-26-phone-downloads-lifecycle.md §2).
    public static final String CHECKING = "checking", NEEDS_ROOM = "needs-room", QUEUED = "queued",
            WAITING_WIFI = "waiting-wifi", WAITING_HOME = "waiting-home", WAITING_STORAGE = "waiting-storage",
            DOWNLOADING = "downloading", PAUSED = "paused", PARTLY_READY = "partly-ready", READY = "ready",
            UPDATING = "updating", REMOVING = "removing", NOT_AVAILABLE = "not-available", DAMAGED = "damaged";

    /** What is known about one kept item; {@link #state()} picks its one state. */
    public static final class Facts {
        public int done, total, failed, damaged, moving;
        public boolean checking, needsRoom, removing, notAvailable, paused, waitingHome, waitingNetwork,
                waitingStorage, wasReady;

        public String state() {
            if (removing) return REMOVING;
            if (checking) return CHECKING;
            if (needsRoom) return NEEDS_ROOM;
            if (notAvailable) return NOT_AVAILABLE;
            if (paused) return PAUSED;
            if (waitingHome) return WAITING_HOME;
            if (total > 0 && done >= total && damaged == 0) return READY;
            if (failed > 0 && done + failed >= total) return PARTLY_READY;
            if (damaged > 0) return DAMAGED;
            if (waitingStorage) return WAITING_STORAGE;
            if (waitingNetwork) return WAITING_WIFI;
            if (wasReady && done < total) return UPDATING;
            if (moving > 0) return DOWNLOADING;
            return QUEUED;
        }
    }

    /** Kept for older callers: the state from the counts alone. */
    public static String stateOf(int done, int total, int failed, boolean waitingNetwork, boolean waitingStorage,
                                 boolean waitingHome) {
        Facts f = new Facts();
        f.done = done; f.total = total; f.failed = failed; f.waitingNetwork = waitingNetwork;
        f.waitingStorage = waitingStorage; f.waitingHome = waitingHome; f.moving = 1;
        return f.state();
    }

    /** The inbox report's state for the web: queued | downloading | ready | failed | refused | removed. */
    public static String reportState(String state) {
        if (state == null) return DOWNLOADING;
        switch (state) {
            case READY: return "ready";
            case NEEDS_ROOM: return "refused";
            case PARTLY_READY: return "failed";
            case REMOVING: return "removed";
            case DOWNLOADING: case UPDATING: case DAMAGED: return "downloading";
            default: return "queued";
        }
    }

    /** Kept automatically while listening (spec §3.10): the label every surface shows with the state. */
    public static final String KEPT_AUTOMATICALLY = "Kept automatically";

    /**
     * The state's words, exactly as every surface shows them. An item kept automatically says
     * so: "Kept automatically · 230 MB" when ready, "Downloading 3 of 12 · 84 MB · Kept
     * automatically" before.
     */
    public static String describe(JSONObject k) {
        String words = stateWords(k);
        if (!k.optBoolean("auto")) return words;
        if (READY.equals(k.optString("state", ""))) {
            return (k.optBoolean("finished") ? "Finished · " : "") + KEPT_AUTOMATICALLY + " · " + size(k.optLong("bytes"));
        }
        return words + " · " + KEPT_AUTOMATICALLY;
    }

    private static String stateWords(JSONObject k) {
        int done = k.optInt("done"), total = k.optInt("total"), failed = k.optInt("failed"), damaged = k.optInt("damaged");
        String reason = k.optString("reason", "");
        long bytes = k.optLong("bytes"), expected = k.optLong("expectedBytes");
        switch (k.optString("state", "")) {
            case CHECKING: return "Checking size…";
            case NEEDS_ROOM: return "Needs " + size(Math.max(1, k.optLong("needBytes"))) + " more room";
            case QUEUED: return "Queued";
            case WAITING_WIFI: return "Waiting for Wi-Fi";
            case WAITING_HOME: return "Waiting for home";
            case WAITING_STORAGE: return "Phone storage is full";
            case DOWNLOADING:
                return "Downloading " + done + " of " + total + " · " + size(bytes)
                        + (expected > bytes ? " of " + size(expected) : "");
            case PAUSED: return "Paused";
            case PARTLY_READY:
                return done + " of " + total + " ready · " + failed + " couldn't download" + (reason.isEmpty() ? "" : ": " + reason);
            case READY: return (k.optBoolean("finished") ? "Finished · " : "On this phone · ") + size(bytes);
            case UPDATING: return "Updating: " + Math.max(1, total - done) + " new";
            case REMOVING: return "Removing…";
            case NOT_AVAILABLE: return "On the SD card — not inserted";
            case DAMAGED: return damaged + (damaged == 1 ? " track needs" : " tracks need") + " downloading again";
            default: break;
        }
        // An index written before states (an older build).
        if (failed > 0) return failed + " of " + total + " did not download";
        if (done < total) return k.optBoolean("waiting") ? "Waiting for Wi-Fi" : "Downloading " + done + " of " + total;
        return "On this phone · " + size(bytes);
    }

    /** The action a row offers beside Remove: Retry, Resume, Manage space, Use mobile data once, or none. */
    public static String action(JSONObject k) {
        switch (k.optString("state", "")) {
            case PARTLY_READY: return "Retry";
            case PAUSED: return "Resume";
            case NEEDS_ROOM: case WAITING_STORAGE: return "Manage space";
            case WAITING_WIFI: return "Use mobile data once";
            default: return k.optInt("failed") > 0 && k.optString("state", "").isEmpty() ? "Retry" : "";
        }
    }

    /** Whether a row offers Retry. */
    public static boolean retryable(JSONObject k) { return "Retry".equals(action(k)); }

    /**
     * Whether the state is about to change on its own (bytes moving, a size being checked, a
     * queue about to start, a removal): a screen showing it refreshes every few seconds, not
     * every 30 (audit: On this phone was slow for every state but Downloading).
     */
    public static boolean changing(String state) {
        return DOWNLOADING.equals(state) || CHECKING.equals(state) || QUEUED.equals(state)
                || UPDATING.equals(state) || REMOVING.equals(state);
    }

    /** Whether the item plays from the phone with no network (every track whole). */
    public static boolean ready(JSONObject k) { return READY.equals(k.optString("state")); }

    /**
     * The limit that applies: the setting, but never more than the phone's free space minus
     * a 2 GB reserve (the phone's own room is respected). Bytes; 0 cap means no setting.
     */
    public static long effectiveLimitBytes(long capMb, long freeBytes, long keptBytes) {
        long reserve = 2_000_000_000L;
        long byFree = Math.max(0, keptBytes + freeBytes - reserve);
        long bySetting = capMb <= 0 ? Long.MAX_VALUE : capMb * 1_000_000L;
        return Math.min(bySetting, byFree);
    }

    /** "1.2 GB kept · 4 GB limit · 15 GB free on phone". */
    public static String roomLine(long keptBytes, long capMb, long freeBytes) {
        // The limit shown is the one that applies: the setting or free space minus 2 GB.
        long limit = effectiveLimitBytes(capMb, freeBytes, keptBytes);
        return size(keptBytes) + " kept" + (limit < Long.MAX_VALUE ? " · " + size(limit) + " limit" : "")
                + " · " + size(freeBytes) + " free on phone";
    }

    /** "Over the limit by 600 MB: new keeps wait until there is room", or "" when within it. */
    public static String overLine(long limitBytes, long keptBytes) {
        long over = keptBytes - limitBytes;
        return over > 0 ? "Over the limit by " + size(over) + ": new keeps wait until there is room" : "";
    }

    /** Items largest first (what to remove to make room is at the top). */
    public static void largestFirst(List<JSONObject> items) {
        items.sort((a, b) -> Long.compare(b.optLong("bytes"), a.optLong("bytes")));
    }

    /** How far past the cap what is kept now is (bytes, 0 when within): a lowered cap deletes nothing. */
    public static long overCap(long capMb, long usedBytes) {
        return capMb <= 0 ? 0 : Math.max(0, usedBytes - capMb * 1_000_000L);
    }

    public static String size(long bytes) {
        if (bytes <= 0) return "0 MB";
        if (bytes < 500_000L) return "under 1 MB";
        if (bytes >= 1_000_000_000L) return String.format(Locale.US, "%.1f GB", bytes / 1e9);
        return Math.max(1, Math.round(bytes / 1e6)) + " MB";
    }

    /** Whether {@code needBytes} more fits under {@code capMb} with {@code usedBytes} already kept. */
    public static boolean fits(long capMb, long usedBytes, long needBytes) {
        return capMb <= 0 || usedBytes + Math.max(0, needBytes) <= capMb * 1_000_000L;
    }
}
