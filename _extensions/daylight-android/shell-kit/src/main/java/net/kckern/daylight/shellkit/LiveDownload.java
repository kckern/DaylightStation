package net.kckern.daylight.shellkit;

/**
 * One kept item downloading right now, as the row shows it: which track or part is moving, its
 * bytes and length (0 when the length is unknown), the rate, and whether it has stalled.
 * Immutable; KeepStore publishes these once a second through {@link LiveDownloads}.
 */
public final class LiveDownload {
    public final int track, tracks, done;
    public final String kind;
    public final long bytes, total, rate;
    public final DownloadProgress.Phase phase;

    public LiveDownload(int track, int tracks, int done, String kind, long bytes, long total, long rate, DownloadProgress.Phase phase) {
        this.track = track;
        this.tracks = tracks;
        this.done = done;
        this.kind = kind == null ? "" : kind;
        this.bytes = bytes;
        this.total = total > 0 ? total : 0;
        this.rate = rate;
        this.phase = phase;
    }

    public boolean stalled() { return phase != DownloadProgress.Phase.MOVING; }

    /** "Track 1 of 2 · 12.4 of 40.1 MB · 1.2 MB/s" ("Part …" for a book, no count for a single item). */
    public String words() {
        String word = "book".equals(kind) ? "Part " : "Track ";
        String head = tracks > 1 ? word + Math.min(track, tracks) + " of " + tracks + " · " : "";
        return head + DownloadProgress.line(bytes, total, rate, phase);
    }

    /** Finished tracks plus the part of this one, over all of them; -1 when this one's length is unknown (an indeterminate bar). */
    public float fraction() {
        if (total <= 0 || tracks <= 0) return -1;
        float part = Math.min(1f, (float) bytes / total);
        return Math.min(1f, (done + part) / tracks);
    }
}
