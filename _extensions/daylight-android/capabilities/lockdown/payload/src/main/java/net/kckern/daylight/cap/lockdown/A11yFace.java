package net.kckern.daylight.cap.lockdown;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Path;
import android.graphics.Point;
import android.graphics.Rect;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;

import net.kckern.daylight.core.AccessibilityHub;

import java.util.ArrayList;
import java.util.List;

/**
 * What lockdown does with the app's accessibility service. The service belongs to the
 * `accessibility` capability and is held by the core's hub; this class never keeps it,
 * so a service that binds or unbinds later is seen on the next call.
 */
final class A11yFace implements AccessibilityHub.EventListener {
    interface WindowsChanged { void onWindowsChanged(); }

    private final AccessibilityHub hub;
    private volatile WindowsChanged windowsChanged;
    private volatile String eventPackage;
    private volatile String eventActivity;

    A11yFace(AccessibilityHub hub) { this.hub = hub; }

    void onWindowsChanged(WindowsChanged listener) { windowsChanged = listener; }

    boolean bound() { return hub.service() != null; }

    /**
     * Every window on screen with its package, title and whether it is active, or null
     * when the service is not bound or the read failed. Cheap: the window list, not the
     * node tree under each root.
     */
    List<ForegroundTrail.Win> windows() {
        AccessibilityService s = hub.service();
        if (s == null) return null;
        List<ForegroundTrail.Win> out = new ArrayList<>();
        try {
            List<AccessibilityWindowInfo> list = s.getWindows();
            if (list == null) return null;
            for (AccessibilityWindowInfo w : list) {
                String pkg = "";
                AccessibilityNodeInfo root = w.getRoot();
                if (root != null) {
                    CharSequence p = root.getPackageName();
                    if (p != null) pkg = p.toString();
                    root.recycle();
                }
                CharSequence title = w.getTitle();
                out.add(new ForegroundTrail.Win(w.getType(), pkg, title == null ? "" : title.toString(), w.isActive()));
            }
        } catch (Exception e) {
            return null;
        }
        return out;
    }

    /** Type and size of every window, for the Control Center check. Null when unknown. */
    List<ControlCenter.Window> windowSizes() {
        AccessibilityService s = hub.service();
        if (s == null) return null;
        try {
            List<AccessibilityWindowInfo> list = s.getWindows();
            if (list == null) return null;
            List<ControlCenter.Window> out = new ArrayList<>();
            Rect bounds = new Rect();
            for (AccessibilityWindowInfo w : list) {
                if (w == null) continue;
                w.getBoundsInScreen(bounds);
                out.add(new ControlCenter.Window(w.getType(), bounds.width(), bounds.height()));
            }
            return out;
        } catch (Exception e) {
            return null;
        }
    }

    /** The display's real size, or null. */
    @SuppressWarnings("deprecation")
    Point displaySize() {
        AccessibilityService s = hub.service();
        if (s == null) return null;
        try {
            WindowManager wm = (WindowManager) s.getSystemService(Context.WINDOW_SERVICE);
            if (wm == null) return null;
            Point size = new Point();
            wm.getDefaultDisplay().getRealSize(size);
            return size;
        } catch (Exception e) {
            return null;
        }
    }

    /** The activity last reported in front for this package, or null when not known. */
    String activityFor(String pkg) {
        return pkg != null && pkg.equals(eventPackage) ? eventActivity : null;
    }

    /**
     * Start an activity from the accessibility service's own context. Android exempts an
     * app with a bound accessibility service from the background-activity-start block
     * (Measured on API 29, piano-bridge README: a plain start answered OK and did nothing).
     */
    boolean startActivity(Intent intent) {
        AccessibilityService s = hub.service();
        if (s == null || intent == null) return false;
        try {
            s.startActivity(intent);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    boolean home() {
        AccessibilityService s = hub.service();
        try { return s != null && s.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME); }
        catch (Exception e) { return false; }
    }

    /** A straight swipe; the Control Center's own dismiss gesture is a swipe down. */
    boolean swipe(float fromX, float fromY, float toX, float toY, int durationMs) {
        AccessibilityService s = hub.service();
        if (s == null) return false;
        try {
            Path p = new Path();
            p.moveTo(fromX, fromY);
            p.lineTo(toX, toY);
            GestureDescription gesture = new GestureDescription.Builder()
                    .addStroke(new GestureDescription.StrokeDescription(p, 0, Math.max(1, durationMs)))
                    .build();
            return s.dispatchGesture(gesture, null, null);
        } catch (Exception e) {
            return false;
        }
    }

    // ── AccessibilityHub.EventListener (the service's main thread) ────────────

    @Override public void onAccessibilityEvent(AccessibilityEvent e) {
        if (e == null) return;
        int type = e.getEventType();
        if (type == AccessibilityEvent.TYPE_WINDOWS_CHANGED) {
            WindowsChanged l = windowsChanged;
            if (l != null) l.onWindowsChanged();
            return;
        }
        if (type != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
        CharSequence pkg = e.getPackageName(), cls = e.getClassName();
        if (pkg == null || cls == null) return;
        AccessibilityService s = hub.service();
        if (s == null) return;
        // The class of a window-state event is an activity, a dialog or a view. Only an
        // activity updates what is in front; a dialog over an allowed activity must not
        // look like a different activity.
        try {
            s.getPackageManager().getActivityInfo(new ComponentName(pkg.toString(), cls.toString()), 0);
            eventPackage = pkg.toString();
            eventActivity = cls.toString();
        } catch (Exception notAnActivity) {
            if (!pkg.toString().equals(eventPackage)) { eventPackage = pkg.toString(); eventActivity = null; }
        }
    }
}
