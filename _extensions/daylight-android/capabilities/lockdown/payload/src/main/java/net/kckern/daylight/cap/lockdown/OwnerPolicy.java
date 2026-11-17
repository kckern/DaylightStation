package net.kckern.daylight.cap.lockdown;

import android.app.ActivityManager;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.UserManager;

import net.kckern.daylight.core.UnsupportedException;

import java.util.List;
import java.util.Set;

/**
 * Device-admin and device-owner calls (owner mode is from portal-keys' KioskPolicy,
 * pointed at this app's own Activity). Every method tolerates this app being neither,
 * and a device with no device-policy service at all.
 */
final class OwnerPolicy {
    static final String ADMIN_CLASS = "net.kckern.daylight.cap.lockdown.shell.DaylightAdminReceiver";

    private final Context context;
    private final DevicePolicyManager dpm;
    private final ActivityManager activities;
    private final ComponentName admin;

    OwnerPolicy(Context context) {
        this.context = context;
        dpm = (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
        activities = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        admin = new ComponentName(context.getPackageName(), ADMIN_CLASS);
    }

    boolean adminActive() {
        try { return dpm != null && dpm.isAdminActive(admin); } catch (Exception e) { return false; }
    }

    boolean isOwner() {
        try { return dpm != null && dpm.isDeviceOwnerApp(context.getPackageName()); } catch (Exception e) { return false; }
    }

    /** False on a device that can never have a device admin or a device owner (the Shield). */
    boolean adminFeature() {
        try {
            PackageManager pm = context.getPackageManager();
            return pm != null && pm.hasSystemFeature(PackageManager.FEATURE_DEVICE_ADMIN);
        } catch (Exception e) {
            return false;
        }
    }

    void lockNow() {
        if (!adminActive()) throw new UnsupportedException("device admin required");
        dpm.lockNow();
    }

    void reboot() {
        if (!isOwner()) throw new UnsupportedException("device owner required");
        dpm.reboot(admin);
    }

    boolean lockTaskActive() {
        try { return activities != null && activities.getLockTaskModeState() == ActivityManager.LOCK_TASK_MODE_LOCKED; }
        catch (Exception e) { return false; }
    }

    /**
     * Apply the owner-mode policy. Returns null on success, else the error text.
     * home may be null when the kiosk Activity's component is not known yet.
     */
    String apply(Set<String> lockTaskPackages, ComponentName home, boolean restrictions, List<String> hidePackages) {
        if (!isOwner()) return "not device owner";
        try {
            if (home != null) {
                IntentFilter filter = new IntentFilter(Intent.ACTION_MAIN);
                filter.addCategory(Intent.CATEGORY_HOME);
                filter.addCategory(Intent.CATEGORY_DEFAULT);
                dpm.addPersistentPreferredActivity(admin, filter, home);
            }
            dpm.setLockTaskPackages(admin, lockTaskPackages.toArray(new String[0]));
            if (Build.VERSION.SDK_INT >= 28) dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE);
            // Without this an overlay window cannot be created (Measured on the Portal, portal-keys README).
            dpm.clearUserRestriction(admin, UserManager.DISALLOW_CREATE_WINDOWS);
            dpm.setKeyguardDisabled(admin, true);
            boolean statusBar = dpm.setStatusBarDisabled(admin, true);
            if (restrictions) {
                for (String r : new String[] { UserManager.DISALLOW_SAFE_BOOT, UserManager.DISALLOW_FACTORY_RESET,
                        UserManager.DISALLOW_ADD_USER, UserManager.DISALLOW_APPS_CONTROL }) {
                    dpm.addUserRestriction(admin, r);
                }
            }
            for (String p : hidePackages) dpm.setApplicationHidden(admin, p, true);
            return statusBar ? null : "status-bar policy rejected";
        } catch (Exception e) {
            return e.getClass().getSimpleName() + ": " + e.getMessage();
        }
    }

    /** Leave lock task available to nothing and give the status bar back. Restrictions and hidden packages stay. */
    String release() {
        if (!isOwner()) return null;
        try {
            dpm.setLockTaskPackages(admin, new String[0]);
            dpm.setStatusBarDisabled(admin, false);
            return null;
        } catch (Exception e) {
            return e.getClass().getSimpleName() + ": " + e.getMessage();
        }
    }

    /** Hide or show one package. Device owner only; false when it could not be done. */
    boolean setHidden(String packageName, boolean hidden) {
        if (!isOwner()) return false;
        try {
            dpm.setApplicationHidden(admin, packageName, hidden);
            return dpm.isApplicationHidden(admin, packageName) == hidden;
        } catch (Exception e) {
            return false;
        }
    }
}
