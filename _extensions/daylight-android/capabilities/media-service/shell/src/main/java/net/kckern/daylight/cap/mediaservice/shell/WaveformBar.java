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
        float x = left + w * fraction;
        if (samples.length == 0) {
            float t = 1.5f * density;
            c.drawRoundRect(left, mid - t, left + w, mid + t, t, t, rest);
            c.drawRoundRect(left, mid - t, x, mid + t, t, t, played);
        } else {
            int n = samples.length;
            float step = w / n, bw = Math.max(1f, step * 0.62f), r = bw / 2f, min = 1.5f * density;
            for (int i = 0; i < n; i++) {
                float half = Math.max(min, samples[i] * h / 2f);
                float bx = left + i * step + (step - bw) / 2f;
                bar.set(bx, mid - half, bx + bw, mid + half);
                c.drawRoundRect(bar, r, r, bx + bw / 2f <= x ? played : rest);
            }
        }
        float hw = 1f * density;
        c.drawRoundRect(x - hw, getPaddingTop(), x + hw, getPaddingTop() + h, hw, hw, head);
    }

    @Override public boolean onTouchEvent(MotionEvent e) {
        if (!isEnabled() || listener == null) return false;
        float w = getWidth() - getPaddingLeft() - getPaddingRight();
        float f = w <= 0 ? 0 : Math.max(0, Math.min(1, (e.getX() - getPaddingLeft()) / w));
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                scrubbing = true;
                getParent().requestDisallowInterceptTouchEvent(true);
                // fall through
            case MotionEvent.ACTION_MOVE:
                fraction = f;
                invalidate();
                listener.onScrub(f, false);
                return true;
            case MotionEvent.ACTION_UP:
                fraction = f;
                scrubbing = false;
                listener.onScrub(f, true);
                performClick();
                return true;
            case MotionEvent.ACTION_CANCEL:
                scrubbing = false;
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
