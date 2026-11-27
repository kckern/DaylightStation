package net.kckern.daylight.cap.mediaservice.shell;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.os.Bundle;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.View;
import android.view.accessibility.AccessibilityNodeInfo;

/**
 * Draws ChapterRail: segments 6 dp tall (at least 4 dp wide), rounded rectangles of a 2 dp
 * radius (never capsules: a 4 dp bar with a 2 dp radius is one), in a
 * 24 dp touch band. Finished segments are filled at 70 % ink, the current one in the accent,
 * the rest outlined at 30 % ink. The highlight rests on exactly one segment and slides (200 ms)
 * when the current segment changes; a tap on another segment goes to its first chapter with a
 * haptic tick, a tap on the current one does nothing. TalkBack reads "Chapter 24 of 33" and
 * offers Previous chapter and Next chapter (a double-tap is Next chapter).
 */
final class ChapterRailView extends View {
    interface Listener { void onChapter(int chapter); }

    private final float d;
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG), stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF r = new RectF();
    private int count, current = -1, ink = 0xffffffff, accent = 0xffffffff;
    /** The highlight mid-slide, in segment units; -1 at rest (on the layout's current segment). */
    private float shown = -1f;
    private ValueAnimator slide;
    private Listener listener;
    private ChapterRail.Layout layout;

    ChapterRailView(Context c) {
        super(c);
        d = c.getResources().getDisplayMetrics().density;
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeWidth(Math.max(1f, d));
        setMinimumHeight(Math.round(24 * d));
        setClickable(true);
    }

    void setListener(Listener l) { listener = l; }

    void setColors(int ink, int accent) {
        this.ink = ink;
        this.accent = accent;
        invalidate();
    }

    /** The chapters and the current one; the highlight slides when only the current segment changed. */
    void setState(int count, int current) {
        if (count == this.count && current == this.current) return;
        ChapterRail.Layout before = this.count == count && getWidth() > 0 ? layout() : null;
        float from = before == null || before.current < 0 ? -1f : before.drawnAt(shown);
        this.count = count;
        this.current = current;
        layout = null;
        setContentDescription(ChapterRail.said(current, count));
        if (slide != null) slide.cancel();
        ChapterRail.Layout after = getWidth() > 0 ? layout() : null;
        int to = after == null ? -1 : after.current;
        if (from >= 0 && to >= 0 && from != to && isShown()) {
            slide = ValueAnimator.ofFloat(from, to).setDuration(200);
            slide.addUpdateListener(a -> {
                // Lands at rest: exactly on the segment, never a float short of it.
                shown = a.getAnimatedFraction() >= 1f ? -1f : (float) a.getAnimatedValue();
                invalidate();
            });
            slide.start();
        } else {
            shown = -1f;
            invalidate();
        }
    }

    private ChapterRail.Layout layout() {
        float width = getWidth() - getPaddingLeft() - getPaddingRight();
        if (layout == null || Math.abs(layout.segments * (layout.segmentPx + layout.gapPx) - layout.gapPx - width) > 1f) {
            layout = ChapterRail.layout(count, current, width, 4 * d, 3 * d);
        }
        return layout;
    }

    @Override protected void onSizeChanged(int w, int h, int ow, int oh) {
        layout = null;
        if (slide != null) slide.cancel();
        shown = -1f;
    }

    @Override protected void onDraw(Canvas canvas) {
        ChapterRail.Layout l = layout();
        if (l.segments == 0) return;
        float h = 6 * d, top = (getHeight() - h) / 2f, radius = 2 * d, x0 = getPaddingLeft();
        for (int i = 0; i < l.segments; i++) {
            r.set(x0 + l.left(i), top, x0 + l.left(i) + l.segmentPx, top + h);
            if (l.done(i)) {
                fill.setColor((ink & 0x00ffffff) | (0xb3 << 24));
                canvas.drawRoundRect(r, radius, radius, fill);
            } else if (i != l.current) {
                stroke.setColor((ink & 0x00ffffff) | (0x4d << 24));
                r.inset(stroke.getStrokeWidth() / 2f, stroke.getStrokeWidth() / 2f);
                canvas.drawRoundRect(r, radius, radius, stroke);
            }
        }
        if (l.current >= 0) {
            // The highlight: on the current segment exactly, or sliding between two.
            float left = x0 + l.highlightLeft(shown);
            r.set(left, top - d, left + l.segmentPx, top + h + d);
            fill.setColor(accent);
            canvas.drawRoundRect(r, radius, radius, fill);
        }
    }

    @Override public boolean onTouchEvent(MotionEvent e) {
        if (e.getActionMasked() == MotionEvent.ACTION_DOWN) return true;
        if (e.getActionMasked() != MotionEvent.ACTION_UP) return super.onTouchEvent(e);
        ChapterRail.Layout l = layout();
        int to = l.tapTo(l.segmentAt(e.getX() - getPaddingLeft()));
        if (to < 0 || listener == null) return true;
        performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK);
        listener.onChapter(to);
        return true;
    }

    // ── TalkBack: Previous chapter, Next chapter (a double-tap is Next) ───────

    @Override public void onInitializeAccessibilityNodeInfo(AccessibilityNodeInfo info) {
        super.onInitializeAccessibilityNodeInfo(info);
        if (current < 0) return;
        info.addAction(new AccessibilityNodeInfo.AccessibilityAction(AccessibilityNodeInfo.ACTION_CLICK, "next chapter"));
        if (ChapterRail.step(current, count, -1) >= 0) {
            info.addAction(new AccessibilityNodeInfo.AccessibilityAction(R.id.daylight_rail_previous, "Previous chapter"));
        }
        if (ChapterRail.step(current, count, 1) >= 0) {
            info.addAction(new AccessibilityNodeInfo.AccessibilityAction(R.id.daylight_rail_next, "Next chapter"));
        }
    }

    @Override public boolean performAccessibilityAction(int action, Bundle args) {
        if (action == R.id.daylight_rail_previous) return stepBy(-1);
        if (action == R.id.daylight_rail_next || action == AccessibilityNodeInfo.ACTION_CLICK) return stepBy(1);
        return super.performAccessibilityAction(action, args);
    }

    private boolean stepBy(int by) {
        int to = ChapterRail.step(current, count, by);
        if (to < 0 || listener == null) return false;
        listener.onChapter(to);
        return true;
    }
}
