package net.kckern.daylight.core;

import android.accessibilityservice.AccessibilityService;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Approves only this app's own Package Installer confirmation after POST /update,
 * and only when the device sets update.autoConfirm. The dialog is recognized by the
 * installer's package and by this app's label in its text.
 */
final class OwnUpdateConfirmation {
    private final AccessibilityHub accessibility;
    private final EventLog eventLog;
    /** This app's label, lower case, as the installer dialog shows it. */
    private final String appLabel;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean pending;
    private long deadline;

    OwnUpdateConfirmation(AccessibilityHub accessibility, EventLog eventLog, String appLabel) {
        this.accessibility = accessibility;
        this.eventLog = eventLog;
        this.appLabel = appLabel == null ? "" : appLabel.trim().toLowerCase(Locale.US);
    }

    void begin() {
        // Without the accessibility service, or without a label to match, there is nothing to tap.
        if (accessibility.service() == null || appLabel.isEmpty()) return;
        pending = true;
        deadline = System.currentTimeMillis() + 90_000;
        handler.removeCallbacks(poll);
        handler.post(poll);
    }

    void finish() {
        pending = false;
        handler.removeCallbacks(poll);
    }

    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (!pending || System.currentTimeMillis() > deadline) {
                pending = false;
                return;
            }
            AccessibilityService service = accessibility.service();
            if (service == null) {
                pending = false;
                return;
            }
            AccessibilityNodeInfo root = service.getRootInActiveWindow();
            if (isOwnInstallDialog(root, appLabel) && clickInstall(root)) {
                pending = false;
                eventLog.add("self-update confirmation-approved");
                return;
            }
            handler.postDelayed(this, 200);
        }
    };

    private static boolean isOwnInstallDialog(AccessibilityNodeInfo root, String appLabel) {
        if (root == null) return false;
        CharSequence packageValue = root.getPackageName();
        String packageName = packageValue == null ? "" : packageValue.toString();
        if (!(packageName.equals("com.android.packageinstaller")
                || packageName.equals("com.google.android.packageinstaller"))) return false;
        StringBuilder text = new StringBuilder();
        collectText(root, text);
        String normalized = text.toString().toLowerCase(Locale.US);
        return normalized.contains(appLabel)
                && !normalized.contains("uninstall")
                && (normalized.contains("install") || normalized.contains("update"));
    }

    private static boolean clickInstall(AccessibilityNodeInfo root) {
        List<AccessibilityNodeInfo> candidates = new ArrayList<>();
        for (String id : new String[]{
                "android:id/button1",
                "com.android.packageinstaller:id/ok_button",
                "com.google.android.packageinstaller:id/ok_button",
        }) {
            try { candidates.addAll(root.findAccessibilityNodeInfosByViewId(id)); }
            catch (Throwable ignored) { }
        }
        if (candidates.isEmpty()) {
            for (String label : new String[]{"Install", "INSTALL", "Update", "UPDATE"}) {
                try { candidates.addAll(root.findAccessibilityNodeInfosByText(label)); }
                catch (Throwable ignored) { }
            }
        }
        for (AccessibilityNodeInfo node : candidates) {
            CharSequence text = node.getText();
            String normalized = text == null ? "" : text.toString().trim().toLowerCase(Locale.US);
            if (!(normalized.isEmpty() || normalized.equals("install")
                    || normalized.equals("update"))) continue;
            AccessibilityNodeInfo clickable = node;
            while (clickable != null && !clickable.isClickable()) clickable = clickable.getParent();
            if (clickable != null
                    && clickable.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true;
        }
        return false;
    }

    private static void collectText(AccessibilityNodeInfo node, StringBuilder out) {
        if (node == null) return;
        CharSequence text = node.getText();
        if (text != null) out.append(' ').append(text);
        CharSequence description = node.getContentDescription();
        if (description != null) out.append(' ').append(description);
        for (int i = 0; i < node.getChildCount(); i++) collectText(node.getChild(i), out);
    }
}
