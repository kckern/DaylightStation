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
import android.view.ViewConfiguration;
import android.view.ViewParent;
import android.view.accessibility.AccessibilityNodeInfo;

/**
 * Draws ChapterRail: segments 6 dp tall and at least 8 dp wide, rounded rectangles of a 2 dp
 * radius (never capsules: a 4 dp bar with a 2 dp radius is one), in a 24 dp touch band.
 * Finished segments are filled at 70 % ink, the current one in the accent, the rest outlined
 * at 30 % ink. The highlight rests on exactly one segment and slides (200 ms) when the current
 * segment changes. A plain tap on another segment goes to its first chapter with a haptic
 * tick; a tap on the current one does nothing. Press and slide scrubs: every chapter is
 * reachable, even on a grouped rail (ChapterRail.Layout.chapterAt), with a tick per chapter
 * and a live description, and the release goes to the chapter under the finger. TalkBack
 * reads "Chapter 24 of 33" and offers Previous chapter and Next chapter (a double-tap is Next
 * chapter).
 */
final class ChapterRailView extends View {
    interface Listener { void onChapter(int chapter); }

    private final float d;
    private final int slop;
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG), stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF r = new RectF();
    private int count, current = -1, ink = 0xffffffff, accent = 0xffffffff;
    /** The highlight mid-slide or under a scrubbing finger, in segment units; -1 at rest (on the layout's current segment). */
    private float shown = -1f;
    private ValueAnimator slide;
    private Listener listener;
    /** The layout and the (count, current, width) it was made for. */
    private ChapterRail.Layout layout;
    private int layoutCount = -1, layoutCurrent = -2;
    private float layoutWidth = -1f;
    /** A press: where it went down, whether it has moved past the touch slop, and the chapter under it. */
    private float downX;
    private boolean scrubbing;
    private int scrubChapter = -1;

    ChapterRailView(Context c) {
        super(c);
        d = c.getResources().getDisplayMetrics().density;
        slop = ViewConfiguration.get(c).getScaledTouchSlop();
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
        if (slide != null) slide.cancel();
        // A finger scrubbing keeps its chapter and words; the release (or cancel) brings them back.
        if (scrubbing) return;
        describe(current);
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

    /** "Chapter 24 of 33" for {@code chapter}; none without a current chapter. */
    private void describe(int chapter) {
        String said = ChapterRail.said(chapter, count);
        setContentDescription(said.isEmpty() ? null : said);
    }

    private ChapterRail.Layout layout() {
        float width = getWidth() - getPaddingLeft() - getPaddingRight();
        if (layout == null || layoutCount != count || layoutCurrent != current || layoutWidth != width) {
            layout = ChapterRail.layout(count, current, width, ChapterRail.MIN_SEGMENT_DP * d, ChapterRail.GAP_DP * d);
            layoutCount = count;
            layoutCurrent = current;
            layoutWidth = width;
        }
        return layout;
    }

    @Override protected void onSizeChanged(int w, int h, int ow, int oh) {
        if (slide != null) slide.cancel();
        endScrub();
        shown = -1f;
    }

    @Override protected void onDetachedFromWindow() {
        super.onDetachedFromWindow();
        if (slide != null) slide.cancel();
        endScrub();
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
            // The loop left the current segment undrawn: the highlight covers it at rest, and
            // while it slides or follows a finger its old place shows as an empty slot.
            float left = x0 + l.highlightLeft(shown);
            r.set(left, top - d, left + l.segmentPx, top + h + d);
            fill.setColor(accent);
            canvas.drawRoundRect(r, radius, radius, fill);
        }
    }

    @Override public boolean onTouchEvent(MotionEvent e) {
        ChapterRail.Layout l = layout();
        float x = e.getX() - getPaddingLeft();
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                downX = e.getX();
                scrubbing = false;
                scrubChapter = -1;
                return true;
            case MotionEvent.ACTION_MOVE:
                if (!scrubbing && Math.abs(e.getX() - downX) > slop && l.segments > 0) {
                    scrubbing = true;
                    if (slide != null) slide.cancel();
                    ViewParent p = getParent();
                    if (p != null) p.requestDisallowInterceptTouchEvent(true);
                }
                if (scrubbing) {
                    // Past either end of the rail is its first or last chapter.
                    float on = Math.max(0f, Math.min(l.left(l.segments - 1) + l.segmentPx, x));
                    int ch = l.chapterAt(on);
                    if (ch >= 0 && ch != scrubChapter) {
                        scrubChapter = ch;
                        performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK);
                        describe(ch);
                        shown = ch / l.perSegment;
                        invalidate();
                    }
                }
                return true;
            case MotionEvent.ACTION_UP: {
                boolean wasScrub = scrubbing;
                int to = scrubChapter;
                endScrub();
                // A release far outside the view (a finger that wandered off) does nothing.
                float far = 48 * d;
                if (e.getY() < -far || e.getY() > getHeight() + far || e.getX() < -far || e.getX() > getWidth() + far) return true;
                if (wasScrub) {
                    if (to >= 0 && to != current && listener != null) listener.onChapter(to);
                    return true;
                }
                performClick();
                int tap = l.tapTo(l.segmentAt(x));
                if (tap < 0 || listener == null) return true;
                performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK);
                listener.onChapter(tap);
                return true;
            }
            case MotionEvent.ACTION_CANCEL:
                endScrub();
                return true;
            default:
                return super.onTouchEvent(e);
        }
    }

    /** A scrub ends (released, cancelled, or the state moved under it): the highlight and words come back to the current chapter. */
    private void endScrub() {
        if (!scrubbing && scrubChapter < 0) return;
        scrubbing = false;
        scrubChapter = -1;
        shown = -1f;
        describe(current);
        invalidate();
    }

    // ── TalkBack: Previous chapter, Next chapter (a double-tap is Next) ───────

    @Override public void onInitializeAccessibilityNodeInfo(AccessibilityNodeInfo info) {
        super.onInitializeAccessibilityNodeInfo(info);
        if (ChapterRail.step(current, count, 1) < 0) {
            // No next chapter: a double-tap would do nothing, so none is offered.
            info.removeAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_CLICK);
            info.setClickable(false);
        }
        if (current < 0) return;
        if (ChapterRail.step(current, count, -1) >= 0) {
            info.addAction(new AccessibilityNodeInfo.AccessibilityAction(R.id.daylight_rail_previous,
                    getContext().getString(R.string.daylight_rail_previous_chapter)));
        }
        if (ChapterRail.step(current, count, 1) >= 0) {
            String next = getContext().getString(R.string.daylight_rail_next_chapter);
            info.addAction(new AccessibilityNodeInfo.AccessibilityAction(AccessibilityNodeInfo.ACTION_CLICK, next));
            info.addAction(new AccessibilityNodeInfo.AccessibilityAction(R.id.daylight_rail_next, next));
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
