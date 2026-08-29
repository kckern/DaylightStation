package net.kckern.portalkeys.payload;

import android.accessibilityservice.AccessibilityService;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityNodeInfo;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Narrowly approves only Portal Keys' own pending USB-access dialog. */
final class UsbPermissionAutomator {
    private final AccessibilityService service;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private volatile boolean pending;
    private volatile long deadline;

    UsbPermissionAutomator(Object accessibilityService) {
        service = accessibilityService instanceof AccessibilityService
                ? (AccessibilityService) accessibilityService : null;
    }

    void begin() {
        if (service == null) return;
        pending = true;
        deadline = System.currentTimeMillis() + 10000;
        handler.post(poll);
    }

    void finish() { pending = false; handler.removeCallbacks(poll); }

    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (!pending || System.currentTimeMillis() > deadline) {
                pending = false;
                return;
            }
            AccessibilityNodeInfo root = service.getRootInActiveWindow();
            if (safeDialog(root) && clickPositive(root)) {
                pending = false;
                return;
            }
            handler.postDelayed(this, 200);
        }
    };

    private static boolean safeDialog(AccessibilityNodeInfo root) {
        if (root == null) return false;
        CharSequence pkgValue = root.getPackageName();
        String pkg = pkgValue == null ? "" : pkgValue.toString();
        if (!(pkg.equals("com.android.systemui")
                || pkg.equals("com.android.packageinstaller")
                || pkg.equals("com.google.android.packageinstaller"))) return false;
        StringBuilder text = new StringBuilder();
        collectText(root, text);
        String normalized = text.toString().toLowerCase(Locale.US);
        return normalized.contains("portal keys")
                && (normalized.contains("usb") || normalized.contains("device"));
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
