package net.kckern.daylight.cap.hidinput;

import android.accessibilityservice.AccessibilityService;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityNodeInfo;
import java.util.ArrayList;
import java.util.List;

/**
 * Narrowly approves only this app's own pending USB-access dialog. Which window
 * that is, is decided by {@link UsbDialogRule}.
 *
 * The accessibility service is looked up each time it is needed. It can bind after
 * the payload has started, and one captured at start would then be null for the
 * whole run.
 */
final class UsbPermissionAutomator {
    /** Where the accessibility service comes from, asked at each use. Null while none is bound. */
    interface ServiceSource { AccessibilityService service(); }

    /** The window on screen, reduced to what the rule needs and the one thing done to it. */
    interface Window {
        String packageName();
        String text();
        boolean clickPositive();
    }

    /** What the automator can see right now. */
    interface Screen {
        /** The active window, or null when there is none or no service is bound. */
        Window activeWindow();
        /** This app's label as the system shows it, or empty when it cannot be read. */
        String appLabel();
    }

    private final Screen screen;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private volatile boolean pending;
    private volatile long deadline;

    /**
     * Takes a {@link ServiceSource} or, as before, the service itself. An Object so
     * that UsbHidController, which hands over whatever it was given, stays unchanged.
     */
    UsbPermissionAutomator(Object accessibilityService) {
        this(new AndroidScreen(sourceOf(accessibilityService)));
    }

    UsbPermissionAutomator(Screen screen) { this.screen = screen; }

    private static ServiceSource sourceOf(Object given) {
        if (given instanceof ServiceSource) return (ServiceSource) given;
        final AccessibilityService fixed = given instanceof AccessibilityService ? (AccessibilityService) given : null;
        return () -> fixed;
    }

    void begin() {
        // No check for a service here: one that binds within the window is used when it appears.
        pending = true;
        deadline = System.currentTimeMillis() + 10000;
        handler.post(poll);
    }

    void finish() { pending = false; handler.removeCallbacks(poll); }

    boolean pending() { return pending; }

    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (!pending || System.currentTimeMillis() > deadline) {
                pending = false;
                return;
            }
            if (tick()) return;
            handler.postDelayed(this, 200);
        }
    };

    /** One look at the screen. True when this app's dialog was found and confirmed. */
    boolean tick() {
        if (!pending) return false;
        Window window = screen.activeWindow();
        if (window == null) return false;
        if (UsbDialogRule.isOwnUsbDialog(window.packageName(), window.text(), screen.appLabel()) && window.clickPositive()) {
            pending = false;
            return true;
        }
        return false;
    }

    /** The real screen, through whichever accessibility service is bound at the moment. */
    private static final class AndroidScreen implements Screen {
        private final ServiceSource source;

        AndroidScreen(ServiceSource source) { this.source = source; }

        @Override public Window activeWindow() {
            AccessibilityService service = source.service();
            if (service == null) return null;
            final AccessibilityNodeInfo root = service.getRootInActiveWindow();
            if (root == null) return null;
            return new Window() {
                @Override public String packageName() {
                    CharSequence pkg = root.getPackageName();
                    return pkg == null ? "" : pkg.toString();
                }
                @Override public String text() {
                    StringBuilder text = new StringBuilder();
                    collectText(root, text);
                    return text.toString();
                }
                @Override public boolean clickPositive() { return UsbPermissionAutomator.clickPositive(root); }
            };
        }

        /** Read from the installed app each time: the label is whatever this build was given. */
        @Override public String appLabel() {
            AccessibilityService service = source.service();
            if (service == null) return "";
            try {
                return String.valueOf(service.getApplicationInfo().loadLabel(service.getPackageManager()));
            } catch (Throwable t) {
                return "";
            }
        }
    }

    private static boolean clickPositive(AccessibilityNodeInfo root) {
        List<AccessibilityNodeInfo> candidates = new ArrayList<>();
        try { candidates.addAll(root.findAccessibilityNodeInfosByViewId("android:id/button1")); }
        catch (Throwable ignored) { }
        if (candidates.isEmpty()) {
            for (String label : new String[]{"Allow", "OK", "허용", "확인"}) {
                try { candidates.addAll(root.findAccessibilityNodeInfosByText(label)); }
                catch (Throwable ignored) { }
            }
        }
        for (AccessibilityNodeInfo node : candidates) {
            AccessibilityNodeInfo clickable = node;
            while (clickable != null && !clickable.isClickable()) clickable = clickable.getParent();
            if (clickable != null && clickable.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true;
        }
        return false;
    }

    private static void collectText(AccessibilityNodeInfo node, StringBuilder out) {
        if (node == null) return;
        CharSequence text = node.getText();
        if (text != null) out.append(' ').append(text);
        CharSequence desc = node.getContentDescription();
        if (desc != null) out.append(' ').append(desc);
        for (int i = 0; i < node.getChildCount(); i++) collectText(node.getChild(i), out);
    }
}
