package net.kckern.daylight.cap.widgets.shell;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.View;

import java.util.function.Consumer;

/**
 * An on/off switch drawn here, so it looks the same everywhere: a pill in the theme's primary
 * when on, its disabled color when off, and a knob in the surface color that always has an
 * edge (a soft shadow), so it never disappears into a card of the same color.
 * The platform switch cut its knob out of its own track.
 */
final class Toggle extends View {
    private final int onColor, offColor, knob, shadow;

    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF box = new RectF();
    private boolean on;
    private float position;
    private ValueAnimator animator;
    private Consumer<Boolean> listener = checked -> { };

    Toggle(Context context, boolean on) {
        super(context);
        net.kckern.daylight.shellkit.DaylightTheme t = net.kckern.daylight.shellkit.DaylightTheme.of(context);
        onColor = t.primary;
        offColor = t.disabled;
        knob = t.surface;
        shadow = t.scrim;
        this.on = on;
        this.position = on ? 1f : 0f;
        setClickable(true);
        setFocusable(true);
        setOnClickListener(v -> toggle());
        setAccessibilityDelegate(new AccessibilityDelegate() {
            @Override public void onInitializeAccessibilityEvent(View host, android.view.accessibility.AccessibilityEvent event) {
                super.onInitializeAccessibilityEvent(host, event);
                event.setChecked(Toggle.this.on);
            }
        });
    }

    void onChange(Consumer<Boolean> listener) {
        this.listener = listener;
    }

    boolean isOn() {
        return on;
    }

    void toggle() {
        set(!on, true);
        listener.accept(on);
    }

    private void set(boolean checked, boolean animate) {
        on = checked;
        if (animator != null) animator.cancel();
        if (!animate) {
            position = checked ? 1f : 0f;
            invalidate();
            return;
        }
        animator = ValueAnimator.ofFloat(position, checked ? 1f : 0f).setDuration(140);
        animator.addUpdateListener(a -> {
            position = (Float) a.getAnimatedValue();
            invalidate();
        });
        animator.start();
    }

    @Override protected void onMeasure(int width, int height) {
        float density = getResources().getDisplayMetrics().density;
        setMeasuredDimension(Math.round(54 * density), Math.round(32 * density));
    }

    @Override protected void onDraw(Canvas canvas) {
        float density = getResources().getDisplayMetrics().density;
        float w = getWidth(), h = getHeight(), pad = 4 * density, r = h / 2f - pad;
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(blend(offColor, onColor, position));
        box.set(0, 0, w, h);
        canvas.drawRoundRect(box, h / 2f, h / 2f, paint);
        float cx = pad + r + position * (w - 2 * pad - 2 * r);
        float cy = h / 2f;
        // A soft edge under the knob keeps it visible on any background.
        paint.setColor(shadow);
        canvas.drawCircle(cx, cy + density, r + 1.5f * density, paint);
        paint.setColor(knob);
        canvas.drawCircle(cx, cy, r, paint);
    }

    private static int blend(int from, int to, float t) {
        int a = Math.round(Color.alpha(from) + (Color.alpha(to) - Color.alpha(from)) * t);
        int r = Math.round(Color.red(from) + (Color.red(to) - Color.red(from)) * t);
        int g = Math.round(Color.green(from) + (Color.green(to) - Color.green(from)) * t);
        int b = Math.round(Color.blue(from) + (Color.blue(to) - Color.blue(from)) * t);
        return Color.argb(a, r, g, b);
    }
}
