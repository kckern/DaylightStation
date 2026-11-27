package net.kckern.daylight.cap.mediaservice.shell;

import org.json.JSONObject;

import java.util.List;
import java.util.Map;

/**
 * What is left of a book (net.kckern.daylight.shellkit.TimeLeft's rule): every part counts,
 * a finished one (or one 97 % in) as heard, one with a place as heard up to it, one never
 * played as all still to come. Before this (2026-11-27) the book page added up only the
 * parts home had a place for, and said "36 min left · 65 %" where the author's row, from
 * every part, said "1 h 38 min left". Pure.
 */
final class BookLeft {
    final long leftSec, totalSec;
    final int percent;
    final boolean started, finished;

    private BookLeft(long leftSec, long totalSec, int percent, boolean started, boolean finished) {
        this.leftSec = leftSec; this.totalSec = totalSec; this.percent = percent; this.started = started; this.finished = finished;
    }

    /**
     * @param ids       the book's parts, every one
     * @param lengths   each part's length (seconds) as its row says, for parts with no place
     * @param progress  {id: {playhead, duration, finished}} for the parts home has a place for
     */
    static BookLeft of(List<String> ids, Map<String, Long> lengths, JSONObject progress) {
        long played = 0, total = 0;
        boolean any = false, allDone = !ids.isEmpty();
        for (String id : ids) {
            JSONObject p = progress == null ? null : progress.optJSONObject(id);
            long known = lengths == null || lengths.get(id) == null ? 0 : Math.max(0, lengths.get(id));
            // The part's own length first (the same one the author's row adds up), its place's
            // recorded length only when the row has none: the two can differ by seconds.
            long d = known > 0 ? known : p != null ? Math.max(0, p.optLong("duration")) : 0;
            total += d;
            if (p == null) { allDone = false; continue; }
            any = true;
            long at = Math.max(0, Math.min(d, p.optLong("playhead")));
            boolean done = p.optBoolean("finished") || (d > 0 && at >= d * 0.97);
            played += done ? d : at;
            if (!done) allDone = false;
        }
        int pct = total > 0 ? (int) Math.round(played * 100.0 / total) : 0;
        return new BookLeft(Math.max(0, total - played), total, pct, any, any && allDone);
    }
}
