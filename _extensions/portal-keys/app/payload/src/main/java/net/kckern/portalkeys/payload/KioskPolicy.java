package net.kckern.portalkeys.payload;

import android.app.ActivityManager;
import android.app.ActivityOptions;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.SystemClock;
import android.os.UserManager;
import org.json.JSONObject;

/** Android policy enforcement; the helper is the DPC and Fully remains the Home app. */
final class KioskPolicy {
    private final Context context;
    private final DevicePolicyManager manager;
    private final ActivityManager activities;
    private final ComponentName admin;
    private final ComponentName fully = new ComponentName("de.ozerov.fully", "de.ozerov.fully.LauncherReplacement");
    private long appliedAt, launchedAt;
    private boolean policyApplied, statusBarDisabled;
    private String error;

    KioskPolicy(Context context) {
        this.context = context;
        manager = (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
        activities = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        admin = new ComponentName(context.getPackageName(), "net.kckern.portalkeys.PortalAdminReceiver");
    }
    boolean isOwner() { return manager.isDeviceOwnerApp(context.getPackageName()); }
    boolean locked() { return activities.getLockTaskModeState() == ActivityManager.LOCK_TASK_MODE_LOCKED; }
    void enforce(boolean homeCorrect) {
        if (!isOwner()) { policyApplied = false; return; }
        long now = SystemClock.elapsedRealtime();
        try {
            if (!policyApplied || !homeCorrect || now - appliedAt >= 5000) {
                IntentFilter home = new IntentFilter(Intent.ACTION_MAIN);
                home.addCategory(Intent.CATEGORY_HOME); home.addCategory(Intent.CATEGORY_DEFAULT);
                manager.addPersistentPreferredActivity(admin, home, fully);
                manager.setLockTaskPackages(admin, new String[]{"de.ozerov.fully"});
                manager.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE);
                statusBarDisabled = manager.setStatusBarDisabled(admin, true);
                if (!statusBarDisabled) throw new IllegalStateException("status-bar-policy-rejected");
                manager.setUninstallBlocked(admin, "de.ozerov.fully", true);
                manager.clearUserRestriction(admin, UserManager.DISALLOW_CREATE_WINDOWS);
                manager.setKeyguardDisabled(admin, true);
                manager.setOrganizationName(admin, "School Portal");
                for (String restriction : new String[]{UserManager.DISALLOW_SAFE_BOOT, UserManager.DISALLOW_FACTORY_RESET,
                        UserManager.DISALLOW_ADD_USER, UserManager.DISALLOW_APPS_CONTROL}) {
                    manager.addUserRestriction(admin, restriction);
                }
                // A second browser must not remain a fallback if Fully crashes.
                android.content.pm.PackageInfo webview = android.webkit.WebView.getCurrentWebViewPackage();
                for (String browser : new String[]{"org.chromium.chrome", "com.android.chrome"}) {
                    if (webview == null || !browser.equals(webview.packageName)) manager.setApplicationHidden(admin, browser, true);
                }
                boolean hide = context.getSharedPreferences("kiosk-policy", Context.MODE_PRIVATE).getBoolean("hideShellUi", true);
                manager.setApplicationHidden(admin, "com.facebook.alohaapps.controlcenter", hide);
                manager.setApplicationHidden(admin, "com.android.systemui", hide);
                appliedAt = now; policyApplied = true;
            }
            if ((!locked() || !homeCorrect) && (launchedAt == 0 || now - launchedAt >= 1000)) {
                Intent launch = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
                        .setComponent(fully).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                // Launch options do not pin an already-existing unpinned task on this ROM.
                // Recreate it on the first repair instead of spending seconds retrying it.
                ActivityOptions options = ActivityOptions.makeBasic(); options.setLockTaskEnabled(true);
                context.startActivity(launch, options.toBundle()); launchedAt = now;
            }
            error = null;
        } catch (Exception e) { policyApplied = false; error = e.getClass().getSimpleName() + ": " + e.getMessage(); }
    }
    JSONObject status() throws Exception {
        return new JSONObject().put("deviceOwner", isOwner()).put("policyApplied", policyApplied)
                .put("statusBarDisabled", statusBarDisabled).put("lockTaskLocked", locked())
                .put("lockTaskMode", activities.getLockTaskModeState())
                .put("shellUiHidden", isOwner() && manager.isApplicationHidden(admin, "com.android.systemui"))
                .put("controlCenterHidden", isOwner() && manager.isApplicationHidden(admin, "com.facebook.alohaapps.controlcenter"))
                .put("allowedPackages", isOwner() ? new org.json.JSONArray(java.util.Arrays.asList(manager.getLockTaskPackages(admin))) : JSONObject.NULL)
                .put("lockTaskFeatures", isOwner() ? manager.getLockTaskFeatures(admin) : JSONObject.NULL)
                .put("error", error == null ? JSONObject.NULL : error);
    }
    JSONObject configureShellUi(boolean hidden) throws Exception {
        if (!isOwner()) throw new IllegalStateException("Device-owner authority required");
        context.getSharedPreferences("kiosk-policy", Context.MODE_PRIVATE).edit().putBoolean("hideShellUi", hidden).commit();
        policyApplied = false;
        return new JSONObject().put("ok", true).put("shellUiSuppressionRequested", hidden);
    }
    boolean menusSuppressed() {
        return isOwner() && manager.isApplicationHidden(admin, "com.android.systemui")
                && manager.isApplicationHidden(admin, "com.facebook.alohaapps.controlcenter");
    }
    boolean protectedHome() { return isOwner() && policyApplied && error == null; }
}
