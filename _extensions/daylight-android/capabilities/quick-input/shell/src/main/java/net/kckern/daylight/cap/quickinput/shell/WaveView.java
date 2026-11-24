package net.kckern.daylight.cap.quickinput.shell;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.View;

/**
 * A live waveform: one bar per sample of the mic level, newest at the right, the rest sliding
 * left as time passes, like a voice memo app. Feed it with {@link #push} every few tens of
 * milliseconds; {@link #clear} flattens it.
 */
final class WaveView extends View {
    private static final float BAR_DP = 4f, GAP_DP = 3f, MIN_DP = 3f;

    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF bar = new RectF();
    private float[] levels = new float[0];
    private int count;

    WaveView(Context context, int color) {
        super(context);
        paint.setColor(color);
        setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
    }

    /** Add one sample, a mic level from 0 to 32767. Quiet speech must still move the bars, so the scale is a curve. */
    void push(int amplitude) {
        if (levels.length == 0) return;
        float level = Math.min(1f, (float) Math.pow(Math.max(0, amplitude) / 9000f, 0.55));
        System.arraycopy(levels, 1, levels, 0, levels.length - 1);
        levels[levels.length - 1] = level;
        count = Math.min(levels.length, count + 1);
        invalidate();
    }

    void clear() {
        java.util.Arrays.fill(levels, 0f);
        count = 0;
        invalidate();
    }

    @Override protected void onSizeChanged(int width, int height, int oldWidth, int oldHeight) {
        float density = getResources().getDisplayMetrics().density;
        int bars = Math.max(1, Math.round(width / ((BAR_DP + GAP_DP) * density)));
        float[] next = new float[bars];
        // Keep what is already there, aligned to the right.
        int keep = Math.min(bars, levels.length);
        System.arraycopy(levels, levels.length - keep, next, bars - keep, keep);
        levels = next;
    }

    @Override protected void onDraw(Canvas canvas) {
        float density = getResources().getDisplayMetrics().density;
        float barWidth = BAR_DP * density, step = (BAR_DP + GAP_DP) * density, minHeight = MIN_DP * density;
        float middle = getHeight() / 2f;
        float usable = getHeight() - minHeight;
        for (int i = 0; i < levels.length; i++) {
            float level = levels[i];
            float h = minHeight + usable * level;
            float x = getWidth() - (levels.length - i) * step + (step - barWidth) / 2f;
            // Older bars fade a little, so the eye follows the newest.
            paint.setAlpha(i < levels.length - count ? 70 : 90 + Math.round(165f * i / Math.max(1, levels.length - 1)));
            bar.set(x, middle - h / 2f, x + barWidth, middle + h / 2f);
            canvas.drawRoundRect(bar, barWidth / 2f, barWidth / 2f, paint);
        }
    }
}
