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

    /**
     * For an unlock window: leave lock task available to nothing and give the status bar
     * back, so the device can be worked on. Restrictions, hidden packages and the home
     * preference stay; the relock puts lock task and the status bar policy back.
     */
    String relax() {
        if (!isOwner()) return null;
        try {
            dpm.setLockTaskPackages(new String[0]);
            dpm.setStatusBarDisabled(false);
            return null;
        } catch (Exception e) {
            return e.getClass().getSimpleName() + ": " + e.getMessage();
        }
    }

    /** DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS: what a device has before any owner sets features. */
    static final int LOCK_TASK_FEATURES_DEFAULT = 16;

    /**
     * Undo everything apply() sets, so the device is as it was before this app held
     * it: the persistent preferred HOME (without this the device would keep resolving
     * Home to this app whatever was chosen later, and after an uninstall to nothing),
     * the lock-task packages and features, the keyguard and status-bar policies, the
     * four user restrictions and every hidden package. Each step is tried even when
     * one before it failed. Returns null when all of them were done, else what failed.
     *
     * @param hidePackages the packages apply() hides on this device (lockdown.ownerHidePackages)
     */
    String release(List<String> hidePackages) {
        if (!isOwner()) return "not device owner";
        StringBuilder failed = new StringBuilder();
        step(failed, "clear the home preference", () -> dpm.clearPersistentPreferredActivities(ownPackage));
        step(failed, "clear the lock-task packages", () -> dpm.setLockTaskPackages(new String[0]));
        if (dpm.sdk() >= 28) step(failed, "reset the lock-task features", () -> dpm.setLockTaskFeatures(LOCK_TASK_FEATURES_DEFAULT));
        step(failed, "enable the keyguard", () -> dpm.setKeyguardDisabled(false));
        step(failed, "enable the status bar", () -> dpm.setStatusBarDisabled(false));
        for (final String r : RESTRICTIONS) step(failed, "clear " + r, () -> dpm.clearUserRestriction(r));
        for (final String p : hidePackages) step(failed, "show " + p, () -> dpm.setApplicationHidden(p, false));
        return failed.length() == 0 ? null : failed.toString();
    }

    private static void step(StringBuilder failed, String what, Runnable call) {
        try {
            call.run();
        } catch (Exception e) {
            if (failed.length() > 0) failed.append("; ");
            failed.append("could not ").append(what).append(" (").append(e.getClass().getSimpleName()).append(")");
        }
    }

    /** Why a transfer cannot even be tried on this device, or null. Asked before anything is released. */
    String transferRefusal() {
        return dpm.sdk() < 28 ? "transferOwnership needs Android 9 (API 28); this device is API " + dpm.sdk() : null;
    }

    /**
     * Hand device ownership to another admin component (DevicePolicyManager.transferOwnership,
     * API 28). Throws what the system throws; the caller reports it.
     */
    void transferOwnership(String packageName, String className) {
        if (!isOwner()) throw new UnsupportedException("device owner required");
        if (dpm.sdk() < 28) throw new UnsupportedException("transferOwnership needs Android 9 (API 28)");
        dpm.transferOwnership(packageName, className);
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
