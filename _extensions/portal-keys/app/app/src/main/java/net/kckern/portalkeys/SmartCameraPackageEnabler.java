package net.kckern.portalkeys;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Enables the Portal system package that owns the public Smart Camera service.
 *
 * The package is present on this panel but can be left DISABLED_USER. An ordinary app
 * cannot change another package's enabled state directly, so the only supported path is
 * the package's own App Info screen. Automation is deliberately constrained to that one
 * package, that one Settings page and an exact enable action.
 */
final class SmartCameraPackageEnabler {
    static final String PACKAGE_NAME = "com.facebook.portal.aiservice";
    private static final long TIMEOUT_MS = 25_000;

    private final AccessibilityService service;
    private final EventLog eventLog;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean pending;
    private boolean clicked;
    private long deadline;
    private Runnable onEnabled;
    private Runnable onFailure;

    SmartCameraPackageEnabler(AccessibilityService service, EventLog eventLog) {
        this.service = service;
        this.eventLog = eventLog;
    }

    static boolean isEnabled(android.content.Context context) {
        try {
            PackageManager pm = context.getPackageManager();
            ApplicationInfo info = pm.getApplicationInfo(PACKAGE_NAME,
                    PackageManager.MATCH_DISABLED_COMPONENTS);
            int setting = pm.getApplicationEnabledSetting(PACKAGE_NAME);
            return info.enabled
                    && setting != PackageManager.COMPONENT_ENABLED_STATE_DISABLED
                    && setting != PackageManager.COMPONENT_ENABLED_STATE_DISABLED_USER
                    && setting != PackageManager.COMPONENT_ENABLED_STATE_DISABLED_UNTIL_USED;
        } catch (PackageManager.NameNotFoundException error) {
            return false;
        }
    }

    void begin(Runnable enabled, Runnable failure) {
        if (isEnabled(service)) {
            handler.post(enabled);
            return;
        }
        onEnabled = enabled;
        onFailure = failure;
        pending = true;
        clicked = false;
        deadline = System.currentTimeMillis() + TIMEOUT_MS;
        handler.removeCallbacks(poll);
        eventLog.add("smart-camera-package-enable-start");
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + PACKAGE_NAME));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            service.startActivity(intent);
            handler.post(poll);
        } catch (RuntimeException error) {
            eventLog.add("smart-camera-package-enable-launch-failed "
                    + error.getClass().getSimpleName());
            complete(false);
        }
    }

    void finish() {
        pending = false;
        handler.removeCallbacks(poll);
        onEnabled = null;
        onFailure = null;
    }

    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (!pending) return;
            if (isEnabled(service)) {
                eventLog.add("smart-camera-package-enabled");
                service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK);
                complete(true);
                return;
            }
            if (System.currentTimeMillis() > deadline) {
                eventLog.add("smart-camera-package-enable-timeout clicked=" + clicked);
                complete(false);
                return;
            }
            AccessibilityNodeInfo activeRoot = service.getRootInActiveWindow();
            AccessibilityNodeInfo settingsRoot = findAiServiceSettingsRoot(activeRoot);
            if (settingsRoot != null && clickEnable(settingsRoot)) {
                clicked = true;
                eventLog.add("smart-camera-package-enable-clicked");
            }
            handler.postDelayed(this, 200);
        }
    };

    private AccessibilityNodeInfo findAiServiceSettingsRoot(AccessibilityNodeInfo activeRoot) {
        if (isAiServiceSettingsPage(activeRoot)) return activeRoot;
        List<AccessibilityWindowInfo> windows = service.getWindows();
        if (windows == null) return null;
        for (AccessibilityWindowInfo window : windows) {
            if (window == null) continue;
            AccessibilityNodeInfo root;
            try { root = window.getRoot(); }
            catch (Throwable ignored) { continue; }
            if (isAiServiceSettingsPage(root)) {
                eventLog.add("smart-camera-package-settings-window-found");
                return root;
            }
        }
        return null;
    }

    private void complete(final boolean enabled) {
        Runnable callback = enabled ? onEnabled : onFailure;
        finish();
        if (callback != null) handler.postDelayed(callback, enabled ? 700 : 0);
    }

    private static boolean isAiServiceSettingsPage(AccessibilityNodeInfo root) {
        if (root == null) return false;
        CharSequence packageValue = root.getPackageName();
        if (packageValue == null || !"com.android.settings".equals(packageValue.toString())) {
            return false;
        }
        StringBuilder text = new StringBuilder();
        collectText(root, text);
        return text.toString().toLowerCase(Locale.US).contains("ai service");
    }

    private static boolean clickEnable(AccessibilityNodeInfo root) {
        List<AccessibilityNodeInfo> candidates = new ArrayList<>();
        for (String label : new String[]{"Enable", "ENABLE", "Turn on", "TURN ON"}) {
            try { candidates.addAll(root.findAccessibilityNodeInfosByText(label)); }
            catch (Throwable ignored) { }
        }
        for (AccessibilityNodeInfo node : candidates) {
            CharSequence value = node.getText();
            String normalized = value == null ? ""
                    : value.toString().trim().toLowerCase(Locale.US);
            if (!("enable".equals(normalized) || "turn on".equals(normalized))) continue;
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
