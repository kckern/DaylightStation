package net.kckern.daylight.cap.mediaservice.shell;

import androidx.media3.datasource.HttpDataSource;

import java.io.IOException;
import java.net.ConnectException;
import java.net.NoRouteToHostException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.util.Locale;

/**
 * The rules downloads live by, kept pure so each is tested: when a failed track is tried
 * again, why it failed in words a person can act on, and
 * whether a byte may be fetched on the network the phone is on.
 */
final class KeepRules {
    private KeepRules() { }

    // ── retry ────────────────────────────────────────────────────────────────

    /** Waits after the 1st, 2nd, 3rd failure; every later one waits a day. */
    static final long[] RETRY_AFTER_MS = { 60_000L, 600_000L, 3_600_000L };
    static final long DAY_MS = 86_400_000L;

    /** When a track that has failed {@code attempts} times (last at {@code failedAt}) is tried again. */
    static long retryAt(int attempts, long failedAt) {
        int i = Math.max(0, attempts - 1);
        return failedAt + (i < RETRY_AFTER_MS.length ? RETRY_AFTER_MS[i] : DAY_MS);
    }

    /** A failure no retry will fix on its own (the file is gone from the library). Retry now still may. */
    static boolean permanent(int httpStatus) { return httpStatus == 404 || httpStatus == 410; }

    // ── keeps waiting for home ───────────────────────────────────────────────

    /**
     * The content id a waiting keep shows as, from the media id it was asked with:
     * "c:<list>" (a list) or "p:<track>|…" (Now playing's album keep), or a bare id.
     */
    static String pendingContentId(String mediaId) {
        if (mediaId == null) return "";
        if (mediaId.startsWith("c:")) return mediaId.substring(2);
        if (mediaId.startsWith("p:")) return mediaId.substring(2).split("\\|")[0];
        return mediaId;
    }

    /**
     * The waiting keeps left after removing the row {@code contentId}. Matched by the id
     * the row shows, so a "p:" keep made from Now playing goes too (before, only "c:"
     * entries matched and a removed "p:" row came back on the next refresh).
     */
    static java.util.List<String> pendingWithout(java.util.List<String> pending, String contentId) {
        java.util.List<String> out = new java.util.ArrayList<>();
        for (String mid : pending) if (!pendingContentId(mid).equals(contentId)) out.add(mid);
        return out;
    }

    // ── reasons ──────────────────────────────────────────────────────────────

    static final String GONE = "Gone from the library";
    static final String REFUSED = "Home refused it";
    static final String HOME_PROBLEM = "Home had a problem";
    static final String UNREACHABLE = "Home not reachable";
    static final String FULL = "Phone full";
    static final String INCOMPLETE = "Incomplete file";
    static final String UNKNOWN = "Did not download";

    static String reasonForStatus(int status) {
        if (status == 404 || status == 410) return GONE;
        if (status == 401 || status == 403) return REFUSED;
        if (status >= 500) return HOME_PROBLEM;
        return UNKNOWN;
    }

    /** The HTTP status inside a download failure, or 0. */
    static int statusOf(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof HttpDataSource.InvalidResponseCodeException) return ((HttpDataSource.InvalidResponseCodeException) t).responseCode;
        }
        return 0;
    }

    /** Why a download failed, from its exception. */
    static String reasonFor(Throwable e) {
        int status = statusOf(e);
        if (status > 0) return reasonForStatus(status);
        for (Throwable t = e; t != null; t = t.getCause()) {
            String m = t.getMessage() == null ? "" : t.getMessage().toLowerCase(Locale.ROOT);
            if (m.contains("enospc") || m.contains("no space left")) return FULL;
            if (t instanceof UnknownHostException || t instanceof ConnectException || t instanceof NoRouteToHostException
                    || t instanceof SocketTimeoutException) return UNREACHABLE;
            if (t instanceof HttpDataSource.HttpDataSourceException && !(t instanceof HttpDataSource.InvalidResponseCodeException)) {
                return UNREACHABLE;
            }
        }
        return e instanceof IOException ? UNREACHABLE : UNKNOWN;
    }

    /** After a failure for this reason, the partial file is thrown away rather than resumed onto. */
    static boolean discardPartial(String reason) { return FULL.equals(reason) || INCOMPLETE.equals(reason); }

    // ── the network rule ─────────────────────────────────────────────────────

    /**
     * Whether a byte for a keep may be fetched now: a size check, a cover, a re-sync, a track.
     * Unmetered always; metered (mobile data, a hotspot) only when the person allowed it.
     */
    static boolean networkAllows(boolean connected, boolean metered, boolean cellularAllowed) {
        return connected && (!metered || cellularAllowed);
    }

    // ── asking first ─────────────────────────────────────────────────────────

    /** A keep bigger than a quarter of the space set for downloads is asked about once. */
    static boolean askFirst(long needBytes, long capMb) {
        return capMb > 0 && needBytes > capMb * 1_000_000L / 4;
    }

    // ── clocks ───────────────────────────────────────────────────────────────

    /**
     * A time stored from the wall clock, never later than now: a clock set back (or a wrong
     * one corrected) makes a stored future time "now", so nothing waits forever on it.
     */
    static long notAfterNow(long stored, long now) { return stored > now ? now : stored; }

    /** Whether a track that failed {@code attempts} times is due again, robust to clock changes. */
    static boolean retryDue(int attempts, long failedAt, long now) {
        return now >= retryAt(attempts, notAfterNow(failedAt, now));
    }

    /**
     * A 404 is permanent only once a fresh URL (the list resolved again) also got one: a stale
     * part URL is fixed by re-resolving, the library having lost the file is not.
     */
    static boolean permanentAfter(int httpStatus, boolean reresolved) { return permanent(httpStatus) && reresolved; }

    /** A finished book is removed (media.removeFinished) a day after it was first seen finished. */
    static boolean removeFinishedDue(long finishedAt, long now) { return removeFinishedDue(finishedAt, now, DAY_MS); }

    /** As above with the delay set (media.removeFinishedAfterMin; a day unless shortened for a check). */
    static boolean removeFinishedDue(long finishedAt, long now, long afterMs) {
        return finishedAt > 0 && now - notAfterNow(finishedAt, now) >= Math.max(60_000L, afterMs);
    }

    static final String NOT_ON_MOBILE = "Not allowed on mobile data";
    static final String CARD_REMOVED = "Card removed";

    // ── what a file is ───────────────────────────────────────────────────────

    /**
     * Whether the first bytes of a kept file are audio (MP3 with ID3 or a frame sync, FLAC,
     * Ogg/Opus, MP4/M4A/M4B, WAV, AAC ADTS). A page or a JSON error stored as a track is not.
     */
    static boolean looksLikeAudio(byte[] head) {
        if (head == null || head.length < 4) return false;
        if (head[0] == 'I' && head[1] == 'D' && head[2] == '3') return true;
        if (head[0] == 'f' && head[1] == 'L' && head[2] == 'a' && head[3] == 'C') return true;
        if (head[0] == 'O' && head[1] == 'g' && head[2] == 'g' && head[3] == 'S') return true;
        if (head[0] == 'R' && head[1] == 'I' && head[2] == 'F' && head[3] == 'F') return true;
        if (head.length >= 8 && head[4] == 'f' && head[5] == 't' && head[6] == 'y' && head[7] == 'p') return true;
        // MPEG audio frame sync (11 bits set) or AAC ADTS (12 bits set).
        return (head[0] & 0xFF) == 0xFF && (head[1] & 0xE0) == 0xE0;
    }

    // ── where downloads live ─────────────────────────────────────────────────

    static final String INTERNAL = "internal", SD = "sd", SD_MISSING = "sd-missing";

    /**
     * The location downloads use: the SD card when it is asked for and there; "sd-missing"
     * when it is asked for (or holds the downloads) and is not inserted: never treated as
     * deleted, nothing reconciled against it; internal otherwise.
     */
    static String location(String setting, boolean cardPresent, String activeBefore) {
        boolean wantSd = SD.equals(setting);
        boolean wasSd = SD.equals(activeBefore);
        if ((wantSd || wasSd) && !cardPresent) return SD_MISSING;
        return wantSd && cardPresent ? SD : INTERNAL;
    }

    // ── words ────────────────────────────────────────────────────────────────

    /** What Keep keeps, said before anything downloads: "Keep the book · 14 parts". */
    static String keepWords(String kind, int count) {
        if ("book".equals(kind)) return "Keep the book · " + count + (count == 1 ? " part" : " parts");
        if ("playlist".equals(kind)) return "Keep the playlist · " + count + (count == 1 ? " track" : " tracks") + " (updates when it changes)";
        return "Keep the album · " + count + (count == 1 ? " track" : " tracks");
    }

    /** "1.2 GB · 13.8 GB left · on Wi-Fi" (size unknown until Wi-Fi: "size shown on Wi-Fi"). */
    static String roomWords(long needBytes, long leftAfterBytes, boolean wifiOnly) {
        String net = wifiOnly ? " · on Wi-Fi" : "";
        if (needBytes < 0) return "Size shown on Wi-Fi" + net;
        return net.isEmpty() ? sizeWords(needBytes) + " · " + sizeWords(Math.max(0, leftAfterBytes)) + " left"
                : sizeWords(needBytes) + " · " + sizeWords(Math.max(0, leftAfterBytes)) + " left" + net;
    }

    static String sizeWords(long bytes) { return net.kckern.daylight.shellkit.KeptIndex.size(bytes); }

    /** The inline line while a keep's size is read: "Checking size of Paradise Lost…". */
    static String checkingWords(String title) {
        return title == null || title.trim().isEmpty() ? "Checking size…" : "Checking size of " + title.trim() + "…";
    }

    // ── sizes home did not give ──────────────────────────────────────────────

    /**
     * The size of what a keep still has to fetch, as words: "1.2 GB", "at least 1.2 GB" when
     * some parts gave no size, "size unknown" when none did. Never "0 B" for parts whose size
     * could not be read (audit H13).
     */
    static String needWords(long knownBytes, int unknownParts) {
        if (unknownParts <= 0) return sizeWords(knownBytes);
        if (knownBytes <= 0) return "size unknown";
        return "at least " + sizeWords(knownBytes);
    }

    /** "1.2 GB · 13.8 GB left · on Wi-Fi", with the unknown parts said ("size unknown · on Wi-Fi"). */
    static String roomWords(long knownBytes, int unknownParts, long leftAfterBytes, boolean wifiOnly) {
        if (knownBytes < 0) return roomWords(-1, leftAfterBytes, wifiOnly);
        if (unknownParts <= 0) return roomWords(knownBytes, leftAfterBytes, wifiOnly);
        String net = wifiOnly ? " · on Wi-Fi" : "";
        if (knownBytes <= 0) return "size unknown" + net;
        return needWords(knownBytes, unknownParts) + " · " + sizeWords(Math.max(0, leftAfterBytes)) + " left" + net;
    }

    // ── what a download waits for ────────────────────────────────────────────

    /**
     * What the downloads notification says when Media3 holds them back, by the requirement
     * not met (its {@code notMetRequirements} flags), never "Waiting for Wi-Fi" for a full
     * phone (audit: one line for any unmet need). Storage first: it is the one the person
     * has to act on.
     */
    static String waitingWords(int notMet) {
        if ((notMet & androidx.media3.exoplayer.scheduler.Requirements.DEVICE_STORAGE_NOT_LOW) != 0) {
            return "Waiting: phone storage is low";
        }
        if ((notMet & androidx.media3.exoplayer.scheduler.Requirements.NETWORK_UNMETERED) != 0) return "Waiting for Wi-Fi";
        if ((notMet & androidx.media3.exoplayer.scheduler.Requirements.NETWORK) != 0) return "Waiting for a network";
        if ((notMet & androidx.media3.exoplayer.scheduler.Requirements.DEVICE_CHARGING) != 0) return "Waiting for the charger";
        if ((notMet & androidx.media3.exoplayer.scheduler.Requirements.DEVICE_IDLE) != 0) return "Waiting until the phone is idle";
        return "Waiting";
    }

    /** One confirmation above a quarter of the limit or of the free space. */
    static boolean askFirst(long needBytes, long limitBytes, long freeBytes) {
        return needBytes > 0 && (needBytes > limitBytes / 4 || needBytes > freeBytes / 4);
    }

    /** The name in "Keeping X on this phone": the one track when only one was kept, else the collection. */
    static String keepingName(String collectionTitle, int trackCount, String firstTrackTitle, String fallback) {
        if (trackCount == 1 && firstTrackTitle != null && !firstTrackTitle.isEmpty()) return firstTrackTitle;
        return collectionTitle == null || collectionTitle.isEmpty() ? fallback : collectionTitle;
    }
}
