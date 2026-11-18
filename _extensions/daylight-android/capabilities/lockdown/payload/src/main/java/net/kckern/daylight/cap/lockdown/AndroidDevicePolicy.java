package net.kckern.daylight.cap.lockdown;

import android.app.ActivityManager;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Build;

import net.kckern.daylight.core.UnsupportedException;

/** DevicePolicy over DevicePolicyManager. Reads tolerate a device with no device-policy service. */
final class AndroidDevicePolicy implements DevicePolicy {
    static final String ADMIN_CLASS = "net.kckern.daylight.cap.lockdown.shell.DaylightAdminReceiver";

    private final Context context;
    private final DevicePolicyManager dpm;
    private final ActivityManager activities;
    private final ComponentName admin;

    AndroidDevicePolicy(Context context) {
        this.context = context;
        dpm = (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
        activities = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        admin = new ComponentName(context.getPackageName(), ADMIN_CLASS);
    }

    private DevicePolicyManager required() {
        if (dpm == null) throw new UnsupportedException("this device has no device-policy service");
        return dpm;
    }

    @Override public boolean adminActive() {
        try { return dpm != null && dpm.isAdminActive(admin); } catch (Exception e) { return false; }
    }

    @Override public boolean isOwner() {
        try { return dpm != null && dpm.isDeviceOwnerApp(context.getPackageName()); } catch (Exception e) { return false; }
    }

    @Override public boolean adminFeature() {
        try {
            PackageManager pm = context.getPackageManager();
            return pm != null && pm.hasSystemFeature(PackageManager.FEATURE_DEVICE_ADMIN);
        } catch (Exception e) {
            return false;
        }
    }

    @Override public boolean lockTaskActive() {
        try { return activities != null && activities.getLockTaskModeState() == ActivityManager.LOCK_TASK_MODE_LOCKED; }
        catch (Exception e) { return false; }
    }

    @Override public int sdk() { return Build.VERSION.SDK_INT; }

    @Override public void lockNow() { required().lockNow(); }

    @Override public void reboot() { required().reboot(admin); }

    @Override public void addPersistentPreferredHome(String packageName, String className) {
        IntentFilter filter = new IntentFilter(Intent.ACTION_MAIN);
        filter.addCategory(Intent.CATEGORY_HOME);
        filter.addCategory(Intent.CATEGORY_DEFAULT);
        required().addPersistentPreferredActivity(admin, filter, new ComponentName(packageName, className));
    }

    @Override public void clearPersistentPreferredActivities(String packageName) {
        required().clearPackagePersistentPreferredActivities(admin, packageName);
    }

    @Override public void setLockTaskPackages(String[] packages) { required().setLockTaskPackages(admin, packages); }

    @Override public void setLockTaskFeatures(int features) {
        if (Build.VERSION.SDK_INT >= 28) required().setLockTaskFeatures(admin, features);
    }

    @Override public void setKeyguardDisabled(boolean disabled) { required().setKeyguardDisabled(admin, disabled); }

    @Override public boolean setStatusBarDisabled(boolean disabled) { return required().setStatusBarDisabled(admin, disabled); }

    @Override public void addUserRestriction(String restriction) { required().addUserRestriction(admin, restriction); }

    @Override public void clearUserRestriction(String restriction) { required().clearUserRestriction(admin, restriction); }

    @Override public void setApplicationHidden(String packageName, boolean hidden) {
        required().setApplicationHidden(admin, packageName, hidden);
    }

    @Override public boolean isApplicationHidden(String packageName) { return required().isApplicationHidden(admin, packageName); }

    @Override public void transferOwnership(String packageName, String className) {
        if (Build.VERSION.SDK_INT < 28) throw new UnsupportedException("transferOwnership needs Android 9 (API 28)");
        required().transferOwnership(admin, new ComponentName(packageName, className), null);
    }
}
