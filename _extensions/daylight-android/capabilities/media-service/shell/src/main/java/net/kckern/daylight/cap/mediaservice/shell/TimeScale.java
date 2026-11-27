package net.kckern.daylight.cap.mediaservice.shell;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * The seek bar's time scale (ops:docs/superpowers/specs/2026-11-26-phone-lookup-and-browse.md
 * §12, as revised by §12b after the owner saw an always-on ruler: "too ugly, too crowded").
 *
 * <ul>
 *   <li>At rest there are no labels: chapter notches, and faint time notches on the line by
 *       the item's length alone (§12c, {@link #restTicks}).</li>
 *   <li>While a finger is on the bar, 2 to 4 labels at round points fade in above it in
 *       words ("30 m", "1 h", "2 h 30", never "1:00:00"), with one row of short ticks
 *       between the labels only.</li>
 *   <li>In the press-and-hold zoom the same rule over the zoom's window, with finer labels
 *       ("1:42"); seconds appear only there, and in the finger's readout
 *       ("1:42:30 · +0:30").</li>
 * </ul>
 * Spacing: labels at least three times their own width apart (centre to centre), ticks at
 * least 12 dp apart. Items under 10 minutes have no scale (songs). Pure: the text width is
 * handed in.
 */
final class TimeScale {
    static final long S = 1000, M = 60 * S, H = 60 * M;
    /** The round points a label may fall on. */
    static final long[] STEPS = {
            10 * S, 15 * S, 30 * S, M, 2 * M, 3 * M, 4 * M, 5 * M, 10 * M, 15 * M, 20 * M, 30 * M, 45 * M,
            H, 90 * M, 2 * H, 3 * H, 4 * H, 6 * H, 8 * H, 12 * H, 24 * H };
    static final long MIN_ITEM_MS = 10 * M;
    static final int MIN_LABELS = 2, MAX_LABELS = 4;
    /** Labels at least this many of their own widths apart, centre to centre. */
    static final float LABEL_SPACING = 3f;
    /** Ticks while touched at least this far apart, in dp. */
    static final float TICK_GAP_DP = 12;

    /** How wide a label's text is, in px. */
    interface Width { float of(String text); }

    /** Words on the whole bar ("2 h 30"); clock time in the zoom ("1:42"). */
    enum Style { TOUCH, ZOOM }

    /** One mark: its time, where it sits (0..1 across the span) and its label ("" for a tick). */
    static final class Mark {
        final long ms;
        final float x;
        final String label;
        Mark(long ms, float x, String label) { this.ms = ms; this.x = x; this.label = label; }
    }

    /** A chosen scale: its steps (0 for none) and the marks across the span. */
    static final class Scale {
        static final Scale NONE = new Scale(0, 0, Collections.emptyList(), Collections.emptyList());
        final long labelStep, tickStep;
        final List<Mark> labels, ticks;
        Scale(long labelStep, long tickStep, List<Mark> labels, List<Mark> ticks) {
            this.labelStep = labelStep;
            this.tickStep = tickStep;
            this.labels = labels;
            this.ticks = ticks;
        }
        boolean isEmpty() { return labelStep == 0; }
    }

    private TimeScale() { }

    /** Whether an item of {@code durationMs} carries a scale at all. */
    static boolean applies(long durationMs) { return durationMs >= MIN_ITEM_MS; }

    /** Multiples of {@code step} strictly inside (start, end). */
    static int count(long startMs, long endMs, long step) {
        if (step <= 0 || endMs <= startMs) return 0;
        long first = (startMs / step + 1) * step;
        if (first >= endMs) return 0;
        return (int) ((endMs - 1 - first) / step) + 1;
    }

    /**
     * The labelled step for the span (start, end) across {@code widthPx}: the smallest giving
     * 2 to 4 labels at least three of their widths apart; if none gives 2, the smallest
     * giving one that fits; 0 for none.
     */
    static long labelStep(long startMs, long endMs, long durationMs, float widthPx, Width width, Style style) {
        if (widthPx <= 0 || endMs <= startMs) return 0;
        long fallback = 0;
        for (long step : STEPS) {
            int n = count(startMs, endMs, step);
            if (n > MAX_LABELS) continue;
            if (n == 0) break;
            float widest = 0;
            for (long t = (startMs / step + 1) * step; t < endMs; t += step) widest = Math.max(widest, width.of(label(t, durationMs, style)));
            float apart = widthPx * step / (float) (endMs - startMs);
            if (apart < LABEL_SPACING * widest) continue;
            if (n >= MIN_LABELS) return step;
            if (fallback == 0) fallback = step;
        }
        return fallback;
    }

    /**
     * The tick step for a labelled step: a round step dividing it into 4, 3, 5 or 2 parts
     * whose ticks stay {@link #TICK_GAP_DP} apart; 0 for none.
     */
    static long tickStep(long labelStep, long spanMs, float widthPx, float density) {
        if (labelStep <= 0 || spanMs <= 0) return 0;
        for (int parts : new int[] { 4, 3, 5, 2 }) {
            if (labelStep % parts != 0) continue;
            long s = labelStep / parts;
            if (!isStep(s)) continue;
            if (widthPx * s / (float) spanMs >= TICK_GAP_DP * density) return s;
        }
        return 0;
    }

    private static boolean isStep(long s) {
        for (long step : STEPS) if (step == s) return true;
        return false;
    }

    /** The scale of the span (start, end) of an item of {@code durationMs}: labels, and ticks between them only. */
    static Scale of(long startMs, long endMs, long durationMs, float widthPx, float density, Width width, Style style) {
        if (!applies(durationMs) || endMs <= startMs) return Scale.NONE;
        long label = labelStep(startMs, endMs, durationMs, widthPx, width, style);
        if (label == 0) return Scale.NONE;
        long span = endMs - startMs;
        List<Mark> labels = new ArrayList<>(), ticks = new ArrayList<>();
        for (long t = (startMs / label + 1) * label; t < endMs; t += label) {
            labels.add(new Mark(t, (t - startMs) / (float) span, label(t, durationMs, style)));
        }
        long tick = labels.size() >= 2 ? tickStep(label, span, widthPx, density) : 0;
        if (tick > 0) {
            long first = labels.get(0).ms, last = labels.get(labels.size() - 1).ms;
            for (long t = first + tick; t < last; t += tick) {
                if (t % label != 0) ticks.add(new Mark(t, (t - startMs) / (float) span, ""));
            }
        }
        return new Scale(label, tick, labels, ticks);
    }

    /** A tick at rest: where it sits (0..1) and whether it is on a whole hour (drawn a little taller). */
    static final class Tick {
        final float x;
        final boolean hour;
        Tick(float x, boolean hour) { this.x = x; this.hour = hour; }
    }

    /**
     * The ticks at rest (§12c), by the item's length only: 6 h or more, each hour; 1 to 6 h,
     * each 30 min (the hours a little taller); 20 to 60 min, each 10 min; under 20 min, none.
     */
    static List<Tick> restTicks(long durationMs) {
        long every;
        if (durationMs >= 6 * H) every = H;
        else if (durationMs >= H) every = 30 * M;
        else if (durationMs >= 20 * M) every = 10 * M;
        else return Collections.emptyList();
        List<Tick> out = new ArrayList<>();
        for (long t = every; t < durationMs; t += every) out.add(new Tick(t / (float) durationMs, every < H && t % H == 0));
        return out;
    }

    /**
     * The labels that can be drawn without touching: each centred on its mark, kept inside
     * the bar, clear of the one before, of the zoom's window-end labels
     * ({@code reservedLeftPx}/{@code reservedRightPx}) and of chapter numbers
     * ({@code chaptersPx}). A label that would touch is dropped, never moved.
     */
    static List<Mark> drawable(List<Mark> labels, float widthPx, float density, Width width,
                               float reservedLeftPx, float reservedRightPx, float[] chaptersPx) {
        List<Mark> out = new ArrayList<>();
        float gap = 8 * density;
        float lastRight = reservedLeftPx > 0 ? reservedLeftPx + gap : -Float.MAX_VALUE;
        for (Mark m : labels) {
            float w = width.of(m.label);
            float cx = m.x * widthPx, l = cx - w / 2f, r = cx + w / 2f;
            if (l < 0 || r > widthPx) continue;
            if (l < lastRight) continue;
            if (reservedRightPx > 0 && r > widthPx - reservedRightPx - gap) continue;
            boolean onChapter = false;
            if (chaptersPx != null) for (float c : chaptersPx) if (c >= l - 2 * density && c <= r + 2 * density) { onChapter = true; break; }
            if (onChapter) continue;
            out.add(m);
            lastRight = r + gap;
        }
        return out;
    }

    /** A label: words on the whole bar ("45 m", "2 h", "2 h 30"), clock time in the zoom ("1:42"; "42:30" under an hour). */
    static String label(long ms, long durationMs, Style style) {
        long s = Math.max(0, ms / 1000);
        long h = s / 3600, m = (s % 3600) / 60, sec = s % 60;
        if (style == Style.ZOOM) {
            if (durationMs >= H) return sec == 0 ? String.format(java.util.Locale.ROOT, "%d:%02d", h, m)
                    : String.format(java.util.Locale.ROOT, "%d:%02d:%02d", h, m, sec);
            return String.format(java.util.Locale.ROOT, "%d:%02d", s / 60, sec);
        }
        if (h > 0) return m == 0 ? h + " h" : String.format(java.util.Locale.ROOT, "%d h %02d", h, m);
        if (sec == 0) return m + " m";
        return String.format(java.util.Locale.ROOT, "%d:%02d", m, sec);
    }

    /** A time in the item's own form: h:mm:ss for an item of an hour or more, m:ss otherwise (the readout and the zoom's ends). */
    static String format(long ms, long durationMs) {
        long s = Math.max(0, ms / 1000);
        if (durationMs >= H) return String.format(java.util.Locale.ROOT, "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60);
        return String.format(java.util.Locale.ROOT, "%d:%02d", s / 60, s % 60);
    }

    /** The zoom's window ends: clock time to the minute ("1:42"), with seconds under an hour. */
    static String windowEnd(long ms, long durationMs) {
        long s = Math.max(0, ms / 1000);
        if (durationMs >= H) return String.format(java.util.Locale.ROOT, "%d:%02d", s / 3600, (s % 3600) / 60);
        return String.format(java.util.Locale.ROOT, "%d:%02d", s / 60, s % 60);
    }

    /** "+1:12" / "−0:45": how far the finger is from where the press began. */
    static String offset(long deltaMs) {
        long s = Math.abs(deltaMs) / 1000;
        String body = s >= 3600 ? String.format(java.util.Locale.ROOT, "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
                : String.format(java.util.Locale.ROOT, "%d:%02d", s / 60, s % 60);
        return (deltaMs < 0 ? "−" : "+") + body;
    }

    /** The finger's readout in the zoom: "1:42:30 · +0:30". */
    static String readout(long atMs, long fromMs, long durationMs) {
        return format(atMs, durationMs) + " · " + offset(atMs - fromMs);
    }

    /** The labelled mark crossed going from {@code fromMs} to {@code toMs} (for a haptic tick), or -1. */
    static long crossed(Scale scale, long fromMs, long toMs) {
        if (scale == null || scale.isEmpty() || fromMs == toMs) return -1;
        long lo = Math.min(fromMs, toMs), hi = Math.max(fromMs, toMs);
        for (Mark m : scale.labels) if (m.ms > lo && m.ms <= hi) return m.ms;
        return -1;
    }
}
