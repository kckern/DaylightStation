package net.kckern.daylight.cap.mediaservice.shell;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.os.Bundle;
import android.view.MotionEvent;
import android.view.View;
import android.view.accessibility.AccessibilityNodeInfo;

/**
 * The seek bar, drawn as the track's loudness (Plexamp's waveform): one rounded bar per
 * sample, mirrored about the middle, the part already played in the accent and the rest
 * in the track color, with a thin playhead. With no curve (none analysed yet, a screen
 * that plays video) it is a plain line of the same two colors. Touch and drag to scrub;
 * the listener hears every move and the release. For TalkBack it is a slider that steps
 * 10 s.
 *
 * The time scale (TimeScale, spec §12b) shows only while a finger is on the bar of an item of
 * 10 minutes or more: 2 to 4 labels in words ("1 h", "2 h 30") fade in above the bars with
 * one row of short ticks between them, and fade out on release. The press-and-hold zoom
 * shows clock labels ("1:42"), its window's ends, a thin strip of the whole item with the
 * window on it, and the finger's time and its distance from where the press began
 * ("1:42:30 · +0:30"); a light tick is felt on each labelled mark the finger crosses there.
 * At rest: chapter starts as small notches on the line, and faint time notches by the item's
 * length (§12c: hourly from 6 h, half-hourly from 1 h, every 10 min from 20 min).
 */
final class WaveformBar extends View {
    interface Listener {
        /** {@code fraction} of the length, 0..1; {@code done} on release. */
        void onScrub(float fraction, boolean done);
        /** TalkBack's step: +1 forward, -1 back. */
        void onStep(int direction);
    }

    private final Paint played = new Paint(Paint.ANTI_ALIAS_FLAG), rest = new Paint(Paint.ANTI_ALIAS_FLAG),
            head = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF bar = new RectF();
    private final float density;
    private float[] samples = new float[0];
    private float fraction;
    private boolean scrubbing;
    /** Fine scrubbing: a press held still zooms the bar to FineScrub's window around it. */
    private long durationMs;
    private float[] zoom;
    private float downX;
    private static final long HOLD_MS = 400;
    private final Runnable zoomIn = this::zoomIn;
    private Listener listener;
    private String spoken = "";

    /** The scale's band above the bars, and its marks: the shown ones and the ones fading out. */
    private static final float SCALE_DP = 26;
    private final Paint scaleText = new Paint(Paint.ANTI_ALIAS_FLAG), scaleTick = new Paint(Paint.ANTI_ALIAS_FLAG),
            readout = new Paint(Paint.ANTI_ALIAS_FLAG), overview = new Paint(Paint.ANTI_ALIAS_FLAG);
    private TimeScale.Scale scale = TimeScale.Scale.NONE, fading = TimeScale.Scale.NONE;
    private float[] scaleSpan = { 0f, 1f }, fadingSpan = { 0f, 1f };
    /** 0..1: how far the shown scale has come in (and the old one gone out). */
    private float scaleIn = 1f;
    private android.animation.ValueAnimator scaleFade;
    private float downFraction;
    private long lastTickMs = -1;
    private final TimeScale.Width textWidth = scaleText::measureText;

    WaveformBar(Context context) {
        super(context);
        density = context.getResources().getDisplayMetrics().density;
        setFocusable(true);
        setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_YES);
        float sp = context.getResources().getDisplayMetrics().scaledDensity;
        scaleText.setTextSize(10 * sp);
        readout.setTextSize(11 * sp);
        readout.setFakeBoldText(true);
        readout.setTextAlign(Paint.Align.CENTER);
        setScaleColor(0xff7a7a7a);
    }

    /** The scale's text and ticks (the theme's muted ink). */
    void setScaleColor(int color) {
        scaleText.setColor(color);
        scaleTick.setColor(color);
        invalidate();
    }

    private boolean hasScale() { return TimeScale.applies(durationMs); }

    void setListener(Listener l) { listener = l; }

    void setColors(int playedColor, int restColor) {
        played.setColor(playedColor);
        rest.setColor(restColor);
        head.setColor(playedColor);
        invalidate();
    }

    void setSamples(float[] s) {
        samples = s == null ? new float[0] : s;
        invalidate();
    }

    boolean scrubbing() { return scrubbing; }

    /** The item's length, for fine scrubbing and the scale (0 or unknown: neither). */
    void setDurationMs(long d) {
        long next = Math.max(0, d);
        if (next == durationMs) return;
        boolean had = hasScale();
        durationMs = next;
        if (had != hasScale()) requestLayout();
        rescale(false);
    }

    /**
     * Chooses the scale for what the bar shows now: none at rest, the whole item in words while
     * touched, the zoom's window in clock time; {@code fade} crossfades from the one before.
     */
    private void rescale(boolean fade) {
        float w = getWidth() - getPaddingLeft() - getPaddingRight();
        float[] span = zoom == null ? new float[] { 0f, 1f } : zoom;
        TimeScale.Scale next = !hasScale() || w <= 0 || !scrubbing ? TimeScale.Scale.NONE
                : TimeScale.of((long) (span[0] * durationMs), (long) (span[1] * durationMs), durationMs, w, density, textWidth,
                        zoom == null ? TimeScale.Style.TOUCH : TimeScale.Style.ZOOM);
        if (fade) {
            fading = scale;
            fadingSpan = scaleSpan;
            scaleIn = 0f;
            if (scaleFade != null) scaleFade.cancel();
            scaleFade = android.animation.ValueAnimator.ofFloat(0f, 1f).setDuration(220);
            scaleFade.addUpdateListener(a -> { scaleIn = (float) a.getAnimatedValue(); invalidate(); });
            scaleFade.start();
        } else {
            fading = TimeScale.Scale.NONE;
            scaleIn = 1f;
        }
        scale = next;
        scaleSpan = span;
        invalidate();
    }

    @Override protected void onSizeChanged(int w, int h, int ow, int oh) {
        super.onSizeChanged(w, h, ow, oh);
        rescale(false);
    }

    /** Chapter starts as fractions of the file (empty for none): thin ticks, the current one in the accent. */
    private float[] marks = new float[0];
    private int markCurrent = -1;
    private final Paint markPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint markText = new Paint(Paint.ANTI_ALIAS_FLAG), notch = new Paint(Paint.ANTI_ALIAS_FLAG);

    void setMarks(float[] m, int current, int color) {
        float[] next = m == null ? new float[0] : m;
        if (java.util.Arrays.equals(next, marks) && current == markCurrent && markPaint.getColor() == color) return;
        marks = next;
        markCurrent = current;
        markPaint.setColor(color);
        invalidate();
    }

    private void zoomIn() {
        if (!scrubbing || FineScrub.windowMs(durationMs) == 0) return;
        zoom = FineScrub.window(durationMs, fraction);
        performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS);
        announceForAccessibility("Fine scrubbing");
        lastTickMs = (long) (fraction * durationMs);
        rescale(true);
    }

    /** Fraction of the item at bar position {@code x} (0..1), zoomed or not. */
    private float at(float x) { return zoom == null ? x : FineScrub.map(x, zoom); }

    /** Where the playhead is, 0..1; ignored while a finger holds it. */
    void setFraction(float f, String spokenPosition) {
        spoken = spokenPosition == null ? "" : spokenPosition;
        if (scrubbing) return;
        f = Math.max(0, Math.min(1, f));
        if (Math.abs(f - fraction) * getWidth() < 0.5f) return;
        fraction = f;
        invalidate();
    }

    @Override protected void onMeasure(int w, int h) {
        int bars = Math.round(36 * density) + getPaddingTop() + getPaddingBottom();
        setMeasuredDimension(getDefaultSize(getSuggestedMinimumWidth(), w),
                resolveSize(bars + (hasScale() ? Math.round(SCALE_DP * density) : 0), h));
    }

    /** The top of the bars: below the scale's band when there is one. */
    private float barsTop() { return getPaddingTop() + (hasScale() ? SCALE_DP * density : 0); }

    @Override protected void onDraw(Canvas c) {
        float w = getWidth() - getPaddingLeft() - getPaddingRight();
        float top = barsTop();
        float h = getHeight() - top - getPaddingBottom();
        float left = getPaddingLeft(), mid = top + h / 2f;
        float[] view = zoom == null ? new float[] { 0f, 1f } : zoom;
        float x = left + w * Math.max(0f, Math.min(1f, (fraction - view[0]) / (view[1] - view[0])));
        if (zoom != null) {
            // Fine scrubbing says so: a soft band of the accent behind the bar, ticks at its ends.
            int band = played.getColor();
            Paint soft = new Paint(Paint.ANTI_ALIAS_FLAG);
            soft.setColor((band & 0x00ffffff) | 0x2e000000);
            float r6 = 6 * density;
            c.drawRoundRect(left - 4 * density, top, left + w + 4 * density, top + h, r6, r6, soft);
            float t = 1.5f * density;
            c.drawRect(left - t, top, left + t, top + h, head);
            c.drawRect(left + w - t, top, left + w + t, top + h, head);
        }
        if (samples.length == 0) {
            float t = 1.5f * density;
            c.drawRoundRect(left, mid - t, left + w, mid + t, t, t, rest);
            c.drawRoundRect(left, mid - t, x, mid + t, t, t, played);
        } else {
            // Zoomed: the same number of bars across the window, each the nearest sample.
            int n = zoom == null ? samples.length : Math.max(24, Math.min(samples.length, 72));
            float step = w / n, bw = Math.max(1f, step * 0.62f), r = bw / 2f, min = 1.5f * density;
            for (int i = 0; i < n; i++) {
                float g = view[0] + (view[1] - view[0]) * (i + 0.5f) / n;
                int k = Math.max(0, Math.min(samples.length - 1, (int) (g * samples.length)));
                float half = Math.max(min, samples[k] * h / 2f);
                float bx = left + i * step + (step - bw) / 2f;
                bar.set(bx, mid - half, bx + bw, mid + half);
                c.drawRoundRect(bar, r, r, bx + bw / 2f <= x ? played : rest);
            }
        }
        // Chapter starts: small notches on the line (the current one in the accent); in the zoom,
        // only those in view, each with its number.
        if (marks.length > 0) {
            float tw = 1f * density, th = 3 * density;
            // Faint unless it is the current chapter's: notches, not a comb.
            notch.setColor(markPaint.getColor());
            notch.setAlpha(0x8c);
            for (int i = 0; i < marks.length; i++) {
                float f = (marks[i] - view[0]) / (view[1] - view[0]);
                if (f < 0f || f > 1f) continue;
                float mx = left + w * f;
                Paint p = i == markCurrent ? head : notch;
                c.drawRect(mx - tw / 2f, mid - th, mx + tw / 2f, mid + th, p);
                if (zoom != null) {
                    markText.setColor(p.getColor());
                    markText.setTextSize(10 * density);
                    c.drawText(String.valueOf(i + 2), mx + 3 * density, top + 10 * density, markText);
                }
            }
        }
        // At rest: faint time notches on the line by the item's length (§12c); a chapter notch
        // at the same spot wins.
        if (zoom == null && !scrubbing) {
            overview.setColor((rest.getColor() & 0x00ffffff) | 0x80000000);
            float tw = 1f * density;
            for (TimeScale.Tick tk : TimeScale.restTicks(durationMs)) {
                boolean onChapter = false;
                for (float m : marks) if (Math.abs(m - tk.x) * w < 2 * density) { onChapter = true; break; }
                if (onChapter) continue;
                float mx = left + w * tk.x, th = (tk.hour ? 3.5f : 2.5f) * density;
                c.drawRect(mx - tw / 2f, mid - th, mx + tw / 2f, mid + th, overview);
            }
        }
        drawScale(c, left, w, top, view);
        float hw = 1f * density;
        c.drawRoundRect(x - hw, top, x + hw, top + h, hw, hw, head);
    }

    /**
     * The scale's band: ticks and labels at round times (dimmer when chapter marks are
     * shown; a label on a chapter mark is dropped), and in the zoom the overview strip, the
     * window's end times and the finger's time and offset.
     */
    private void drawScale(Canvas c, float left, float w, float barsTop, float[] view) {
        if (!hasScale()) return;
        float band = SCALE_DP * density, bandTop = barsTop - band;
        float labelBase = barsTop - 4 * density;
        int full = 0xff;
        // The zoom's window ends: their times at the band's two ends.
        float reservedL = 0, reservedR = 0;
        // The finger's readout: no tick label is drawn under it.
        float avoidL = Float.NaN, avoidR = Float.NaN;
        if (zoom != null) {
            String a = TimeScale.windowEnd((long) (zoom[0] * durationMs), durationMs), b = TimeScale.windowEnd((long) (zoom[1] * durationMs), durationMs);
            scaleText.setAlpha(0xff);
            c.drawText(a, left, labelBase - 3 * density, scaleText);
            reservedL = scaleText.measureText(a);
            reservedR = scaleText.measureText(b);
            c.drawText(b, left + w - reservedR, labelBase - 3 * density, scaleText);
            // The whole item, the window on it: where in the book this is.
            float y = bandTop + 2 * density, t = 1.5f * density;
            overview.setColor(rest.getColor());
            c.drawRoundRect(left, y - t, left + w, y + t, t, t, overview);
            overview.setColor(played.getColor());
            c.drawRoundRect(left + w * zoom[0], y - t - density, left + w * Math.max(zoom[1], zoom[0] + 0.01f), y + t + density, t, t, overview);
            // The time under the finger, and how far it is from where the press began.
            long at = (long) (fraction * durationMs), from = (long) (downFraction * durationMs);
            String said = TimeScale.readout(at, from, durationMs);
            float fx = left + w * Math.max(0f, Math.min(1f, (fraction - zoom[0]) / (zoom[1] - zoom[0])));
            float half = readout.measureText(said) / 2f;
            fx = Math.max(left + half, Math.min(left + w - half, fx));
            readout.setColor(played.getColor());
            c.drawText(said, fx, bandTop + 14 * density, readout);
            avoidL = fx - half - 6 * density - left;
            avoidR = fx + half + 6 * density - left;
        }
        if (!fading.isEmpty() && scaleIn < 1f) drawMarks(c, left, w, barsTop, labelBase, fading, fadingSpan, view, (int) (full * (1f - scaleIn)), reservedL, reservedR, avoidL, avoidR);
        drawMarks(c, left, w, barsTop, labelBase, scale, scaleSpan, view, (int) (full * scaleIn), reservedL, reservedR, avoidL, avoidR);
    }

    private void drawMarks(Canvas c, float left, float w, float barsTop, float labelBase, TimeScale.Scale s, float[] span,
                           float[] view, int alpha, float reservedL, float reservedR, float avoidL, float avoidR) {
        if (s.isEmpty() || alpha <= 0) return;
        float spanW = view[1] - view[0];
        // A mark's place on the bar now (a fading scale's marks move with the span they were chosen for).
        java.util.function.Function<TimeScale.Mark, Float> xOf = m -> {
            float f = (span[0] + m.x * (span[1] - span[0]) - view[0]) / spanW;
            return left + w * f;
        };
        scaleTick.setAlpha(alpha);
        float tw = 1f * density;
        for (TimeScale.Mark m : s.ticks) {
            float mx = xOf.apply(m);
            if (mx < left || mx > left + w) continue;
            c.drawRect(mx - tw / 2f, barsTop - 3 * density, mx + tw / 2f, barsTop, scaleTick);
        }
        // Chapters win where they are labelled (the zoom numbers each chapter start): a time
        // label that would sit on a chapter's number is dropped. In the whole bar a chapter
        // is a tick in the bars, below the band, and the labels stand.
        float[] chaptersPx = null;
        if (zoom != null && marks.length > 0) {
            chaptersPx = new float[marks.length];
            for (int i = 0; i < marks.length; i++) chaptersPx[i] = w * (marks[i] - view[0]) / spanW;
        }
        java.util.List<TimeScale.Mark> moved = new java.util.ArrayList<>();
        for (TimeScale.Mark m : s.labels) moved.add(new TimeScale.Mark(m.ms, (xOf.apply(m) - left) / w, m.label));
        scaleText.setAlpha(alpha);
        for (TimeScale.Mark m : TimeScale.drawable(moved, w, density, textWidth, reservedL, reservedR, chaptersPx)) {
            float mx = left + w * m.x;
            float half = scaleText.measureText(m.label) / 2f;
            if (!Float.isNaN(avoidL) && m.x * w + half > avoidL && m.x * w - half < avoidR) continue;
            c.drawRect(mx - tw / 2f, barsTop - 5 * density, mx + tw / 2f, barsTop, scaleTick);
            c.drawText(m.label, mx - scaleText.measureText(m.label) / 2f, labelBase - 3 * density, scaleText);
        }
        scaleText.setAlpha(0xff);
    }

    /** In the zoom, a light tick each time the finger crosses a labelled mark. */
    private void tickOnMarks() {
        if (zoom == null || scale.isEmpty()) return;
        long now = (long) (fraction * durationMs);
        if (lastTickMs >= 0 && TimeScale.crossed(scale, lastTickMs, now) >= 0) {
            performHapticFeedback(android.os.Build.VERSION.SDK_INT >= 21
                    ? android.view.HapticFeedbackConstants.CLOCK_TICK : android.view.HapticFeedbackConstants.VIRTUAL_KEY);
        }
        lastTickMs = now;
    }

    @Override public boolean onTouchEvent(MotionEvent e) {
        if (!isEnabled() || listener == null) return false;
        float w = getWidth() - getPaddingLeft() - getPaddingRight();
        float x = w <= 0 ? 0 : Math.max(0, Math.min(1, (e.getX() - getPaddingLeft()) / w));
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                scrubbing = true;
                zoom = null;
                downX = e.getX();
                getParent().requestDisallowInterceptTouchEvent(true);
                removeCallbacks(zoomIn);
                postDelayed(zoomIn, HOLD_MS);
                fraction = x;
                downFraction = x;
                lastTickMs = -1;
                // A finger on the bar: the scale fades in.
                if (hasScale()) rescale(true); else invalidate();
                listener.onScrub(fraction, false);
                return true;
            case MotionEvent.ACTION_MOVE:
                // A drag before the hold completes is an ordinary scrub.
                if (zoom == null && Math.abs(e.getX() - downX) > 8 * density) removeCallbacks(zoomIn);
                fraction = at(x);
                tickOnMarks();
                invalidate();
                listener.onScrub(fraction, false);
                return true;
            case MotionEvent.ACTION_UP:
                removeCallbacks(zoomIn);
                fraction = at(x);
                scrubbing = false;
                zoom = null;
                rescale(true);   // released: the scale fades out
                listener.onScrub(fraction, true);
                performClick();
                return true;
            case MotionEvent.ACTION_CANCEL:
                removeCallbacks(zoomIn);
                scrubbing = false;
                zoom = null;
                rescale(true);
                listener.onScrub(fraction, false);
                return true;
            default:
                return true;
        }
    }

    @Override public boolean performClick() { return super.performClick(); }

    @Override public void onInitializeAccessibilityNodeInfo(AccessibilityNodeInfo info) {
        super.onInitializeAccessibilityNodeInfo(info);
        info.setClassName("android.widget.SeekBar");
        info.setContentDescription(spoken.isEmpty() ? "Position" : "Position, " + spoken);
        if (isEnabled()) {
            info.addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_FORWARD);
            info.addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_BACKWARD);
        }
    }

    @Override public boolean performAccessibilityAction(int action, Bundle args) {
        if (listener != null && isEnabled()) {
            if (action == AccessibilityNodeInfo.ACTION_SCROLL_FORWARD) { listener.onStep(1); return true; }
            if (action == AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD) { listener.onStep(-1); return true; }
        }
        return super.performAccessibilityAction(action, args);
    }
}
