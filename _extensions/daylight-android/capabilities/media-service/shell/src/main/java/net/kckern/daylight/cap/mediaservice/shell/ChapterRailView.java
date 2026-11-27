package net.kckern.daylight.cap.mediaservice.shell;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.View;

/**
 * Draws ChapterRail: 4 dp rounded segments in a 24 dp touch band. Finished segments are
 * filled at 70 % ink, the current one in the accent, the rest outlined at 30 % ink. The
 * highlight slides (200 ms) when the chapter changes; a tap jumps to a segment's chapter
 * with a haptic tick.
 */
final class ChapterRailView extends View {
    interface Listener { void onChapter(int chapter); }

    private final float d;
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG), stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF r = new RectF();
    private int count, current = -1, ink = 0xffffffff, accent = 0xffffffff;
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

    /** The chapters and the current one; the highlight slides when only the current one changed. */
    void setState(int count, int current) {
        if (count == this.count && current == this.current) return;
        boolean slideIt = count == this.count && this.current >= 0 && current >= 0 && isShown();
        this.count = count;
        this.current = current;
        layout = null;
        setContentDescription(ChapterRail.said(current, count));
        float target = current;
        if (slide != null) slide.cancel();
        if (slideIt) {
            slide = ValueAnimator.ofFloat(shown, target).setDuration(200);
            slide.addUpdateListener(a -> { shown = (float) a.getAnimatedValue(); invalidate(); });
            slide.start();
        } else {
            shown = target;
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

    @Override protected void onSizeChanged(int w, int h, int ow, int oh) { layout = null; }

    @Override protected void onDraw(Canvas canvas) {
        ChapterRail.Layout l = layout();
        if (l.segments == 0) return;
        float h = 4 * d, top = (getHeight() - h) / 2f, radius = h / 2f, x0 = getPaddingLeft();
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
            // The highlight, sliding between segments as the chapter changes.
            float at = shown < 0 ? l.current : shown / l.perSegment;
            float left = x0 + at * (l.segmentPx + l.gapPx);
            r.set(left, top - d, left + l.segmentPx, top + h + d);
            fill.setColor(accent);
            canvas.drawRoundRect(r, radius + d, radius + d, fill);
        }
    }

    @Override public boolean onTouchEvent(MotionEvent e) {
        if (e.getActionMasked() == MotionEvent.ACTION_DOWN) return true;
        if (e.getActionMasked() != MotionEvent.ACTION_UP) return super.onTouchEvent(e);
        ChapterRail.Layout l = layout();
        int seg = l.segmentAt(e.getX() - getPaddingLeft());
        if (seg < 0 || listener == null) return true;
        performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK);
        listener.onChapter(l.chapterOf(seg));
        return true;
    }
}
