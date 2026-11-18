package net.kckern.daylight.core;

import android.accessibilityservice.AccessibilityService;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInstaller;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Taps "Update" on this app's own Package Installer confirmation after POST /update,
 * and only when the device sets update.autoConfirm. What may be tapped is decided by
 * {@link UpdateConfirmRule}; this class gathers the facts it asks for.
 *
 * Checked against the platform: the window's package and whether that package is a
 * system app; that the install session this app committed still exists, was created
 * by this package and (because Updater names it in the session parameters) installs
 * this package. Not available from the platform: which session the dialog on screen
 * belongs to. The accessibility tree of the installer carries no session id.
 */
final class OwnUpdateConfirmation {
    private final Context ctx;
    private final AccessibilityHub accessibility;
    private final EventLog eventLog;
    /** This app's label, as the installer dialog shows it. */
    private final String appLabel;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean pending;
    private long deadline;
    /** The install session the pending update committed. */
    private int sessionId = -1;
    private String lastRefusal;

    OwnUpdateConfirmation(Context ctx, AccessibilityHub accessibility, EventLog eventLog, String appLabel) {
        this.ctx = ctx;
        this.accessibility = accessibility;
        this.eventLog = eventLog;
        this.appLabel = appLabel == null ? "" : appLabel.trim();
    }

    /** Called once the update's install session is committed, with that session's id. */
    void begin(int committedSessionId) {
        // Without the accessibility service, or without a label to match, there is nothing to tap.
        if (accessibility.service() == null || appLabel.isEmpty()) return;
        sessionId = committedSessionId;
        lastRefusal = null;
        pending = true;
        deadline = System.currentTimeMillis() + 90_000;
        handler.removeCallbacks(poll);
        handler.post(poll);
    }

    void finish() {
        pending = false;
        sessionId = -1;
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
            String refusal = root == null ? "no_window" : UpdateConfirmRule.refusal(facts(root));
            if (refusal == null && clickInstall(root)) {
                pending = false;
                eventLog.add("self-update confirmation-approved session=" + sessionId);
                return;
            }
            // One line per distinct reason, so a dialog that was left alone can be explained later.
            if (refusal != null && !refusal.equals(lastRefusal) && !"no_window".equals(refusal)
                    && !"not_installer".equals(refusal)) {
                eventLog.add("self-update confirmation-withheld " + refusal);
            }
            lastRefusal = refusal;
            handler.postDelayed(this, 200);
        }
    };

    private UpdateConfirmRule.Facts facts(AccessibilityNodeInfo root) {
        UpdateConfirmRule.Facts f = new UpdateConfirmRule.Facts();
        f.pending = pending;
        f.nowMs = System.currentTimeMillis();
        f.deadlineMs = deadline;
        CharSequence packageValue = root.getPackageName();
        f.dialogPackage = packageValue == null ? null : packageValue.toString();
        f.dialogPackageIsSystemApp = isSystemApp(f.dialogPackage);
        StringBuilder text = new StringBuilder();
        collectText(root, text);
        f.dialogText = text.toString();
        f.appLabel = appLabel;
        f.ownPackage = ctx.getPackageName();
        try {
            PackageInstaller.SessionInfo info = ctx.getPackageManager().getPackageInstaller().getSessionInfo(sessionId);
            if (info != null) {
                f.sessionFound = true;
                f.sessionInstallerPackage = info.getInstallerPackageName();
                f.sessionAppPackage = info.getAppPackageName();
            }
        } catch (Throwable ignored) {
            // No session facts: the rule refuses.
        }
        return f;
    }

    /** Fails closed: a package this app cannot look up is not treated as the system's. */
    private boolean isSystemApp(String packageName) {
        if (packageName == null) return false;
        try {
            ApplicationInfo info = ctx.getPackageManager().getApplicationInfo(packageName, 0);
            return (info.flags & ApplicationInfo.FLAG_SYSTEM) != 0;
        } catch (Throwable t) {
            return false;
        }
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
