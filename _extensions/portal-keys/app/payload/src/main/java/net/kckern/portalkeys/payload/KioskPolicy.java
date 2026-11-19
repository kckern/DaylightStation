package net.kckern.portalkeys.payload;

import android.app.ActivityManager;
import android.app.ActivityOptions;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.SystemClock;
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
    private String error, lastDrift;
    private long driftRepairs;
    private final PolicyReconciler.Device device = new PolicyReconciler.Device() {
        @Override public void addPersistentHome() {
            IntentFilter home = new IntentFilter(Intent.ACTION_MAIN);
            home.addCategory(Intent.CATEGORY_HOME); home.addCategory(Intent.CATEGORY_DEFAULT);
            manager.addPersistentPreferredActivity(admin, home, fully);
        }
        @Override public String[] lockTaskPackages() { return manager.getLockTaskPackages(admin); }
        @Override public void setLockTaskPackages(String[] p) { manager.setLockTaskPackages(admin, p); }
        @Override public int lockTaskFeatures() { return manager.getLockTaskFeatures(admin); }
        @Override public void setLockTaskFeatures(int f) { manager.setLockTaskFeatures(admin, f); }
        @Override public boolean disableStatusBar() { return manager.setStatusBarDisabled(admin, true); }
        @Override public void disableKeyguard() { manager.setKeyguardDisabled(admin, true); }
        @Override public boolean uninstallBlocked() { return manager.isUninstallBlocked(admin, FULLY_PACKAGE); }
        @Override public void blockUninstall() { manager.setUninstallBlocked(admin, FULLY_PACKAGE, true); }
        @Override public java.util.Set<String> restrictions() {
            android.os.Bundle b = manager.getUserRestrictions(admin);
            java.util.Set<String> out = new java.util.HashSet<>();
            for (String k : b.keySet()) if (b.getBoolean(k)) out.add(k);
            return out;
        }
        @Override public void addRestriction(String r) { manager.addUserRestriction(admin, r); }
        @Override public void clearRestriction(String r) { manager.clearUserRestriction(admin, r); }
        @Override public CharSequence organizationName() { return manager.getOrganizationName(admin); }
        @Override public void setOrganizationName(String n) { manager.setOrganizationName(admin, n); }
        @Override public boolean hidden(String pkg) { return manager.isApplicationHidden(admin, pkg); }
        @Override public void setHidden(String pkg, boolean h) { manager.setApplicationHidden(admin, pkg, h); }
        @Override public String webviewPackage() {
            android.content.pm.PackageInfo w = android.webkit.WebView.getCurrentWebViewPackage();
            return w == null ? null : w.packageName;
        }
    };
    /** Shared with PortalAdminReceiver in the shell, which sets the same key when ownership arrives. */
    static final String PREFS = "kiosk-policy", HOLD = "ownerTransferHold";
    private static final String FULLY_PACKAGE = "de.ozerov.fully";
    private static final String[] RESTRICTIONS = PolicyReconciler.RESTRICTIONS;
    private static final String[] BROWSERS = PolicyReconciler.BROWSERS;
    private static final String[] SHELL_UI = PolicyReconciler.SHELL_UI;

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
    synchronized void enforcePassive(boolean homeCorrect) {
        if (!isOwner()) { policyApplied = false; return; }
        if (held()) { policyApplied = false; error = null; return; }
        long now = SystemClock.elapsedRealtime();
        try {
            if (!policyApplied || !homeCorrect || now - appliedAt >= 5000) {
                // Read back every 5 s, write only drift (see PolicyReconciler). Blind rewrites stalled Fully.
                boolean firstPass = !policyApplied;
                boolean hide = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("hideShellUi", true);
                java.util.List<String> writes = PolicyReconciler.reconcile(device, homeCorrect, firstPass, hide);
                if (firstPass) statusBarDisabled = true;
                else if (!writes.isEmpty()) { driftRepairs++; lastDrift = String.join(",", writes); }
                appliedAt = now; policyApplied = true;
            }
            error = null;
        } catch (Exception e) { policyApplied = false; error = e.getClass().getSimpleName() + ": " + e.getMessage(); }
    }
    synchronized void recoverActivity(boolean homeCorrect, RecoveryGuard guard) {
        if (held() || !isOwner()) return;
        long now=SystemClock.elapsedRealtime();
        if (launchedAt!=0 && now-launchedAt<1000) return;
        try {
            if (repairTask(homeCorrect,locked(),guard,() -> {
                Intent launch=new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
                        .setComponent(fully).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                ActivityOptions options=ActivityOptions.makeBasic(); options.setLockTaskEnabled(true);
                context.startActivity(launch,options.toBundle());
            })) launchedAt=now;
            // A dispatched launch is not readback evidence that lock task was repaired.
        } catch (Exception e) { error=e.getClass().getSimpleName()+": "+e.getMessage(); }
    }
    static boolean repairTask(boolean homeCorrect, boolean locked, RecoveryGuard guard, Runnable launch) {
        return (!locked || !homeCorrect) && guard.run(true,launch);
    }
    JSONObject status() throws Exception {
        return new JSONObject().put("deviceOwner", isOwner()).put("policyApplied", policyApplied).put("driftRepairs", driftRepairs).put("lastDrift", lastDrift == null ? JSONObject.NULL : lastDrift)
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
