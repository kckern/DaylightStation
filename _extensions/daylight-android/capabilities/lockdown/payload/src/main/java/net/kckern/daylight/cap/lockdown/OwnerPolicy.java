package net.kckern.daylight.cap.lockdown;

import net.kckern.daylight.core.UnsupportedException;

import java.util.List;
import java.util.Set;

/**
 * Device-admin and device-owner policy (owner mode is from portal-keys' KioskPolicy,
 * pointed at this app's own HOME alias). Every method tolerates this app being neither
 * admin nor owner, and a device with no device-policy service at all.
 */
final class OwnerPolicy {
    /** UserManager.DISALLOW_* values, copied so this class needs no Android. */
    static final String DISALLOW_CREATE_WINDOWS = "no_create_windows";
    static final String[] RESTRICTIONS = { "no_safe_boot", "no_factory_reset", "no_add_user", "no_control_apps" };
    /** DevicePolicyManager.LOCK_TASK_FEATURE_NONE. */
    static final int LOCK_TASK_FEATURE_NONE = 0;

    private final DevicePolicy dpm;
    private final String ownPackage;

    OwnerPolicy(DevicePolicy dpm, String ownPackage) {
        this.dpm = dpm;
        this.ownPackage = ownPackage;
    }

    boolean adminActive() { return dpm.adminActive(); }
    boolean isOwner() { return dpm.isOwner(); }
    boolean adminFeature() { return dpm.adminFeature(); }
    boolean lockTaskActive() { return dpm.lockTaskActive(); }

    void lockNow() {
        if (!adminActive()) throw new UnsupportedException("device admin required");
        dpm.lockNow();
    }

    void reboot() {
        if (!isOwner()) throw new UnsupportedException("device owner required");
        dpm.reboot();
    }

    /**
     * Apply the owner-mode policy. Returns null on success, else the error text.
     * homeClass is the class of this app's HOME component, or null when the HOME alias
     * is not enabled on the device: no home preference is set then.
     */
    String apply(Set<String> lockTaskPackages, String homeClass, boolean restrictions, List<String> hidePackages) {
        if (!isOwner()) return "not device owner";
        try {
            if (homeClass != null) dpm.addPersistentPreferredHome(ownPackage, homeClass);
            dpm.setLockTaskPackages(lockTaskPackages.toArray(new String[0]));
            if (dpm.sdk() >= 28) dpm.setLockTaskFeatures(LOCK_TASK_FEATURE_NONE);
            // Without this an overlay window cannot be created (Measured on the Portal, portal-keys README).
            dpm.clearUserRestriction(DISALLOW_CREATE_WINDOWS);
            dpm.setKeyguardDisabled(true);
            boolean statusBar = dpm.setStatusBarDisabled(true);
            if (restrictions) {
                for (String r : RESTRICTIONS) dpm.addUserRestriction(r);
            }
            for (String p : hidePackages) dpm.setApplicationHidden(p, true);
            return statusBar ? null : "status-bar policy rejected";
        } catch (Exception e) {
            return e.getClass().getSimpleName() + ": " + e.getMessage();
        }
    }

    /** Leave lock task available to nothing and give the status bar back. Restrictions and hidden packages stay. */
    String release() {
        if (!isOwner()) return null;
        try {
            dpm.setLockTaskPackages(new String[0]);
            dpm.setStatusBarDisabled(false);
            return null;
        } catch (Exception e) {
            return e.getClass().getSimpleName() + ": " + e.getMessage();
        }
    }

    /** Hide or show one package. Device owner only; false when it could not be done. */
    boolean setHidden(String packageName, boolean hidden) {
        if (!isOwner()) return false;
        try {
            dpm.setApplicationHidden(packageName, hidden);
            return dpm.isApplicationHidden(packageName) == hidden;
        } catch (Exception e) {
            return false;
        }
    }
}
