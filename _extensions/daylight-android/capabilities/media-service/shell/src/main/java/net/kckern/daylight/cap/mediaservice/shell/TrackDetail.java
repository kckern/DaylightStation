package net.kckern.daylight.cap.mediaservice.shell;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Locale;

/**
 * What Now playing shows about one track beyond its metadata: the loudness curve drawn as
 * the seek bar, the audio quality line, and the lyrics. Parsed from the payload's
 * track-levels and track-lyrics answers. Pure.
 */
final class TrackDetail {
    private TrackDetail() { }

    /** The loudness curve, 0..1 per sample; empty for none. */
    static float[] samples(JSONObject reply) {
        JSONObject levels = reply == null ? null : reply.optJSONObject("levels");
        JSONArray a = levels == null ? null : levels.optJSONArray("samples");
        if (a == null) return new float[0];
        float[] out = new float[a.length()];
        for (int i = 0; i < out.length; i++) out[i] = (float) Math.max(0, Math.min(1, a.optDouble(i, 0)));
        return out;
    }

    /** "FLAC · 24-bit · 96 kHz", "MP3 · 256 kbps · 44.1 kHz", or "" when nothing is known. */
    static String quality(JSONObject reply) {
        JSONObject levels = reply == null ? null : reply.optJSONObject("levels");
        JSONObject q = levels == null ? null : levels.optJSONObject("quality");
        if (q == null) return "";
        StringBuilder out = new StringBuilder();
        String codec = q.optString("codec", "");
        if (!codec.isEmpty()) out.append(codec.toUpperCase(Locale.ROOT));
        int depth = q.optInt("bitDepth", 0), kbps = q.optInt("bitrate", 0), hz = q.optInt("sampleRate", 0);
        boolean lossless = codec.matches("(?i)flac|alac|wav|aiff|pcm|ape|wavpack");
        // Lossless reads as depth; lossy as its bitrate (a FLAC's kbps says little).
        if (lossless && depth > 0) part(out, depth + "-bit");
        else if (kbps > 0) part(out, kbps + " kbps");
        if (hz > 0) {
            String k = String.format(Locale.US, "%.1f", hz / 1000.0);
            if (k.endsWith(".0")) k = k.substring(0, k.length() - 2);
            part(out, k + " kHz");
        }
        return out.toString();
    }

    private static void part(StringBuilder out, String s) {
        if (out.length() > 0) out.append(" · ");
        out.append(s);
    }

    /** Lyrics: the lines, and their times (ms, or -1 for an unsynced line). */
    static final class Lyrics {
        static final Lyrics NONE = new Lyrics(new String[0], new long[0], false);
        final String[] lines;
        final long[] times;
        final boolean synced;

        Lyrics(String[] lines, long[] times, boolean synced) {
            this.lines = lines;
            this.times = times;
            this.synced = synced;
        }

        boolean isEmpty() { return lines.length == 0; }

        /**
         * The line being sung at {@code positionMs}: the last whose time has come, -1 before
         * the first, and always -1 for unsynced lyrics. A line shows slightly early (LEAD_MS),
         * as a singer reads ahead.
         */
        int indexAt(long positionMs) {
            if (!synced) return -1;
            long t = positionMs + LEAD_MS;
            int lo = 0, hi = times.length - 1, found = -1;
            while (lo <= hi) {
                int mid = (lo + hi) >>> 1;
                if (times[mid] <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
            }
            return found;
        }

        static final long LEAD_MS = 250;
    }

    static Lyrics lyrics(JSONObject reply) {
        JSONObject l = reply == null ? null : reply.optJSONObject("lyrics");
        JSONArray a = l == null ? null : l.optJSONArray("lines");
        if (a == null || a.length() == 0) return Lyrics.NONE;
        boolean synced = l.optBoolean("synced", false);
        String[] lines = new String[a.length()];
        long[] times = new long[a.length()];
        long last = 0;
        for (int i = 0; i < lines.length; i++) {
            JSONObject line = a.optJSONObject(i);
            lines[i] = line == null ? "" : line.optString("text", "");
            long ms = line == null || line.isNull("ms") ? -1 : line.optLong("ms", -1);
            // Times must not go backwards for the search; a stray one takes its predecessor's.
            if (synced) { ms = Math.max(ms, last); last = ms; }
            times[i] = synced ? ms : -1;
        }
        return new Lyrics(lines, times, synced);
    }

    /** The right-hand time: what is left, or the whole length; a tap switches. The left shows elapsed. */
    enum TimeDisplay {
        REMAINING, TOTAL;

        TimeDisplay next() { return this == REMAINING ? TOTAL : REMAINING; }

        static TimeDisplay of(String name) { return "TOTAL".equals(name) ? TOTAL : REMAINING; }

        /** "−3:12" or "4:38"; "" when the length is unknown. */
        String right(long positionMs, long durationMs) { return right(positionMs, durationMs, 1f); }

        /** Time left as it will be spent at {@code speed} (a 1.5x talk ends sooner). */
        String right(long positionMs, long durationMs, float speed) {
            if (durationMs <= 0) return "";
            return this == TOTAL ? NowPlayingActivity.clock(durationMs)
                    : "−" + NowPlayingActivity.clock(LongForm.remainingAtSpeed(positionMs, durationMs, speed));
        }
    }
}
