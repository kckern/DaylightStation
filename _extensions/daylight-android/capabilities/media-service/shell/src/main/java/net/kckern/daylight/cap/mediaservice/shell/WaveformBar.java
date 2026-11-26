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

    WaveformBar(Context context) {
        super(context);
        density = context.getResources().getDisplayMetrics().density;
        setFocusable(true);
        setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_YES);
    }

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

    /** The item's length, for fine scrubbing (0 or unknown: never zoomed). */
    void setDurationMs(long d) { durationMs = Math.max(0, d); }

    /** Chapter starts as fractions of the file (empty for none): thin ticks, the current one in the accent. */
    private float[] marks = new float[0];
    private int markCurrent = -1;
    private final Paint markPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint markText = new Paint(Paint.ANTI_ALIAS_FLAG);

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
        invalidate();
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
        setMeasuredDimension(getDefaultSize(getSuggestedMinimumWidth(), w), resolveSize(Math.round(44 * density), h));
    }

    @Override protected void onDraw(Canvas c) {
        float w = getWidth() - getPaddingLeft() - getPaddingRight();
        float h = getHeight() - getPaddingTop() - getPaddingBottom();
        float left = getPaddingLeft(), mid = getPaddingTop() + h / 2f;
        float[] view = zoom == null ? new float[] { 0f, 1f } : zoom;
        float x = left + w * Math.max(0f, Math.min(1f, (fraction - view[0]) / (view[1] - view[0])));
        if (zoom != null) {
            // Fine scrubbing says so: a soft band of the accent behind the bar, ticks at its ends.
            int band = played.getColor();
            Paint soft = new Paint(Paint.ANTI_ALIAS_FLAG);
            soft.setColor((band & 0x00ffffff) | 0x2e000000);
            float r6 = 6 * density;
            c.drawRoundRect(left - 4 * density, getPaddingTop(), left + w + 4 * density, getPaddingTop() + h, r6, r6, soft);
            float t = 1.5f * density;
            c.drawRect(left - t, getPaddingTop(), left + t, getPaddingTop() + h, head);
            c.drawRect(left + w - t, getPaddingTop(), left + w + t, getPaddingTop() + h, head);
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
        // Chapter starts: a short tick above and below the bars; in the zoom, only those in view.
        if (marks.length > 0) {
            float tw = 1f * density, th = 5 * density;
            for (int i = 0; i < marks.length; i++) {
                float f = (marks[i] - view[0]) / (view[1] - view[0]);
                if (f < 0f || f > 1f) continue;
                float mx = left + w * f;
                Paint p = i == markCurrent ? head : markPaint;
                c.drawRect(mx - tw / 2f, getPaddingTop(), mx + tw / 2f, getPaddingTop() + th, p);
                c.drawRect(mx - tw / 2f, getPaddingTop() + h - th, mx + tw / 2f, getPaddingTop() + h, p);
                // Zoomed in, each start says which chapter it opens.
                if (zoom != null) {
                    markText.setColor(p.getColor());
                    markText.setTextSize(10 * density);
                    c.drawText(String.valueOf(i + 2), mx + 3 * density, getPaddingTop() + th + 9 * density, markText);
                }
            }
        }
        float hw = 1f * density;
        c.drawRoundRect(x - hw, getPaddingTop(), x + hw, getPaddingTop() + h, hw, hw, head);
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
                invalidate();
                listener.onScrub(fraction, false);
                return true;
            case MotionEvent.ACTION_MOVE:
                // A drag before the hold completes is an ordinary scrub.
                if (zoom == null && Math.abs(e.getX() - downX) > 8 * density) removeCallbacks(zoomIn);
                fraction = at(x);
                invalidate();
                listener.onScrub(fraction, false);
                return true;
            case MotionEvent.ACTION_UP:
                removeCallbacks(zoomIn);
                fraction = at(x);
                scrubbing = false;
                zoom = null;
                invalidate();
                listener.onScrub(fraction, true);
                performClick();
                return true;
            case MotionEvent.ACTION_CANCEL:
                removeCallbacks(zoomIn);
                scrubbing = false;
                zoom = null;
                invalidate();
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
