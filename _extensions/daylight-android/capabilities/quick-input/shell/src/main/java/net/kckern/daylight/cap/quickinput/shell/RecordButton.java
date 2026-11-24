package net.kckern.daylight.cap.quickinput.shell;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.view.View;

/**
 * The one big control of the recorder. Idle it is a record dot; while recording, or with a saved
 * draft, it is a send arrow. A ring pulses around it while the mic is open.
 */
final class RecordButton extends View {
    enum Mode { RECORD, SEND }

    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path arrow = new Path();
    private final int accent;
    private Mode mode = Mode.RECORD;
    private boolean pulsing;
    private float pulse;
    private ValueAnimator animator;

    RecordButton(Context context, int accent) {
        super(context);
        this.accent = accent;
        setClickable(true);
        setFocusable(true);
    }

    void setMode(Mode next, boolean pulseRing) {
        if (next == mode && pulseRing == pulsing) return;
        mode = next;
        pulsing = pulseRing;
        setContentDescription(next == Mode.SEND ? "Send" : "Record");
        if (pulseRing) startPulse(); else stopPulse();
        invalidate();
    }

    private void startPulse() {
        if (animator != null) return;
        animator = ValueAnimator.ofFloat(0f, 1f).setDuration(1400);
        animator.setRepeatCount(ValueAnimator.INFINITE);
        animator.addUpdateListener(a -> { pulse = (Float) a.getAnimatedValue(); invalidate(); });
        animator.start();
    }

    private void stopPulse() {
        if (animator != null) { animator.cancel(); animator = null; }
        pulse = 0f;
    }

    @Override protected void onDetachedFromWindow() {
        stopPulse();
        super.onDetachedFromWindow();
    }

    @Override protected void onMeasure(int width, int height) {
        int size = Math.round(112 * getResources().getDisplayMetrics().density);
        setMeasuredDimension(size, size);
    }

    @Override protected void onDraw(Canvas canvas) {
        float w = getWidth(), cx = w / 2f, cy = getHeight() / 2f;
        float base = w * 0.34f;
        if (pulsing) {
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(w * 0.025f);
            paint.setColor(accent);
            paint.setAlpha(Math.round(120 * (1f - pulse)));
            canvas.drawCircle(cx, cy, base + (w * 0.5f - base) * pulse, paint);
        }
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(isEnabled() ? accent : 0xff9aa9a2);
        canvas.drawCircle(cx, cy, base, paint);
        paint.setColor(Color.WHITE);
        if (mode == Mode.RECORD) {
            canvas.drawCircle(cx, cy, base * 0.42f, paint);
        } else {
            // An up arrow: send.
            float r = base * 0.5f;
            arrow.reset();
            arrow.moveTo(cx, cy - r);
            arrow.lineTo(cx + r, cy + r * 0.05f);
            arrow.lineTo(cx + r * 0.38f, cy + r * 0.05f);
            arrow.lineTo(cx + r * 0.38f, cy + r);
            arrow.lineTo(cx - r * 0.38f, cy + r);
            arrow.lineTo(cx - r * 0.38f, cy + r * 0.05f);
            arrow.lineTo(cx - r, cy + r * 0.05f);
            arrow.close();
            canvas.drawPath(arrow, paint);
        }
    }
}
