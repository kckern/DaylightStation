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
final class KioskPolicy implements OwnerTransfer.Device {
    private final Context context;
    private final DevicePolicyManager manager;
    private final ActivityManager activities;
    private final ComponentName admin;
    private final ComponentName fully = new ComponentName("de.ozerov.fully", "de.ozerov.fully.LauncherReplacement");
    private long appliedAt, launchedAt;
    private boolean policyApplied, statusBarDisabled;
    private String error;
    /** Shared with PortalAdminReceiver in the shell, which sets the same key when ownership arrives. */
    static final String PREFS = "kiosk-policy", HOLD = "ownerTransferHold";
    private static final String FULLY_PACKAGE = "de.ozerov.fully";
    private static final String[] RESTRICTIONS = {UserManager.DISALLOW_SAFE_BOOT, UserManager.DISALLOW_FACTORY_RESET,
            UserManager.DISALLOW_ADD_USER, UserManager.DISALLOW_APPS_CONTROL};
    private static final String[] BROWSERS = {"org.chromium.chrome", "com.android.chrome"};
    private static final String[] SHELL_UI = {"com.facebook.alohaapps.controlcenter", "com.android.systemui"};

    KioskPolicy(Context context) {
        this.context = context;
        manager = (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
        activities = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        admin = new ComponentName(context.getPackageName(), "net.kckern.portalkeys.PortalAdminReceiver");
    }
    @Override public boolean isOwner() { return manager.isDeviceOwnerApp(context.getPackageName()); }
    boolean locked() { return activities.getLockTaskModeState() == ActivityManager.LOCK_TASK_MODE_LOCKED; }
    /** True after an ownership transfer released policy; enforce() applies nothing until resume(). */
    boolean held() { return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(HOLD, false); }
    synchronized void enforce(boolean homeCorrect) {
        if (!isOwner()) { policyApplied = false; return; }
        if (held()) { policyApplied = false; error = null; return; }
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
                for (String restriction : RESTRICTIONS) manager.addUserRestriction(admin, restriction);
                // A second browser must not remain a fallback if Fully crashes.
                android.content.pm.PackageInfo webview = android.webkit.WebView.getCurrentWebViewPackage();
                for (String browser : BROWSERS) {
                    if (webview == null || !browser.equals(webview.packageName)) manager.setApplicationHidden(admin, browser, true);
                }
                boolean hide = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("hideShellUi", true);
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
                .put("heldForOwnerTransfer", held())
                .put("lockTaskMode", activities.getLockTaskModeState())
                .put("shellUiHidden", isOwner() && manager.isApplicationHidden(admin, "com.android.systemui"))
                .put("controlCenterHidden", isOwner() && manager.isApplicationHidden(admin, "com.facebook.alohaapps.controlcenter"))
                .put("allowedPackages", isOwner() ? new org.json.JSONArray(java.util.Arrays.asList(manager.getLockTaskPackages(admin))) : JSONObject.NULL)
                .put("lockTaskFeatures", isOwner() ? manager.getLockTaskFeatures(admin) : JSONObject.NULL)
                .put("error", error == null ? JSONObject.NULL : error);
    }
    JSONObject configureShellUi(boolean hidden) throws Exception {
        if (!isOwner()) throw new IllegalStateException("Device-owner authority required");
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("hideShellUi", hidden).commit();
        policyApplied = false;
        return new JSONObject().put("ok", true).put("shellUiSuppressionRequested", hidden);
    }
    boolean menusSuppressed() {
        return isOwner() && manager.isApplicationHidden(admin, "com.android.systemui")
                && manager.isApplicationHidden(admin, "com.facebook.alohaapps.controlcenter");
    }
    boolean protectedHome() { return isOwner() && policyApplied && error == null; }

    // ---- Ownership transfer. The decisions live in OwnerTransfer; these are the Android calls. ----

    /** Serialised with enforce() so a policy tick cannot land between the release and the transfer. */
    synchronized OwnerTransfer.Result transferOwner(String to) { return OwnerTransfer.run(this, to); }

    /** The only way enforcement starts again after a transfer attempt or after ownership comes back. */
    synchronized JSONObject resume() throws Exception {
        if (!context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(HOLD, false).commit())
            throw new IllegalStateException("policy-hold-storage-failed");
        policyApplied = false;
        return new JSONObject().put("ok", true).put("heldForOwnerTransfer", false).put("deviceOwner", isOwner());
    }

    @Override public int sdk() { return android.os.Build.VERSION.SDK_INT; }

    @Override public void holdEnforcement() {
        if (!context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(HOLD, true).commit())
            throw new IllegalStateException("policy-hold-storage-failed");
        policyApplied = false; statusBarDisabled = false;
    }

    /** One case per OwnerTransfer.RELEASE_STEPS entry; each undoes what enforce() applies. */
    @Override public void release(String step) {
        switch (step) {
            case "persistent-home": manager.clearPackagePersistentPreferredActivities(admin, FULLY_PACKAGE); break;
            // Emptying the allowlist also ends lock task for a Fully task that is pinned right now.
            case "lock-task-packages": manager.setLockTaskPackages(admin, new String[0]); break;
            // enforce() sets NONE; the documented platform default is global actions only.
            case "lock-task-features": manager.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS); break;
            case "status-bar": manager.setStatusBarDisabled(admin, false); break;
            case "keyguard": manager.setKeyguardDisabled(admin, false); break;
            case "uninstall-block": manager.setUninstallBlocked(admin, FULLY_PACKAGE, false); break;
            case "user-restrictions": for (String restriction : RESTRICTIONS) manager.clearUserRestriction(admin, restriction); break;
            case "organization-name": manager.setOrganizationName(admin, null); break;
            case "hidden-packages":
                for (String pkg : BROWSERS) manager.setApplicationHidden(admin, pkg, false);
                for (String pkg : SHELL_UI) manager.setApplicationHidden(admin, pkg, false);
                break;
            default: throw new IllegalArgumentException("unknown release step " + step);
        }
    }

    @Override public void transfer(String target) {
        if (android.os.Build.VERSION.SDK_INT < OwnerTransfer.MIN_SDK) throw new UnsupportedOperationException("api-28-required");
        manager.transferOwnership(admin, new ComponentName(OwnerTransfer.TARGET_PACKAGE, OwnerTransfer.TARGET_RECEIVER), null);
    }
}
