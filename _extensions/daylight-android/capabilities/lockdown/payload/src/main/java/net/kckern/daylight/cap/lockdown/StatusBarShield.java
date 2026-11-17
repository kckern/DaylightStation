package net.kckern.daylight.cap.lockdown;

import android.content.Context;
import android.content.res.Resources;
import android.graphics.PixelFormat;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;

import net.kckern.daylight.core.MainThread;

/**
 * A transparent strip over the status bar that eats touches, so the shade cannot be
 * pulled down. Needs the SYSTEM_ALERT_WINDOW appop. On API 26+ an application overlay
 * sits below the system's own status-bar window, so whether this stops the pull on a
 * given device is Unverified; the acceptance checklist tests it per device.
 */
final class StatusBarShield {
    private final Context context;
    private final WindowManager windows;
    private View view;      // main thread only
    /** What was last asked for. The view follows it on the main thread. */
    private volatile boolean wanted;
    volatile boolean shown;

    StatusBarShield(Context context) {
        this.context = context;
        windows = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
    }

    boolean granted() {
        try { return Settings.canDrawOverlays(context); } catch (Exception e) { return false; }
    }

    void set(final boolean on) {
        if (on == wanted && on == shown) return;
        wanted = on;
        if (windows == null) return;
        MainThread.post(() -> {
            try {
                if (wanted && view == null && granted()) {
                    View strip = new View(context);
                    strip.setOnTouchListener((v, e) -> true);
                    WindowManager.LayoutParams p = new WindowManager.LayoutParams(
                            WindowManager.LayoutParams.MATCH_PARENT, height(),
                            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                                    | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                            PixelFormat.TRANSLUCENT);
                    p.gravity = Gravity.TOP;
                    windows.addView(strip, p);
                    view = strip;
                    shown = true;
                } else if (!wanted && view != null) {
                    View old = view;
                    view = null;
                    shown = false;
                    windows.removeView(old);
                }
            } catch (Exception e) {
                view = null;
                shown = false;
            }
        });
    }

    private static int height() {
        Resources r = Resources.getSystem();
        int id = r.getIdentifier("status_bar_height", "dimen", "android");
        int px = id > 0 ? r.getDimensionPixelSize(id) : 0;
        return px > 0 ? px : Math.round(24 * r.getDisplayMetrics().density);
    }
}
