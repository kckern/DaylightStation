package net.kckern.portalkeys.payload;

import java.util.ArrayList;
import java.util.List;

/**
 * Hands device ownership to the one app allowed to take it.
 *
 * Plain Java on purpose: the target check, the release order and the failure
 * reporting run in a JVM unit test against a fake {@link Device}. KioskPolicy
 * is the real Device and holds every DevicePolicyManager call.
 */
final class OwnerTransfer {
    /** The only component ownership may move to. Compared exactly; nothing is trimmed or normalised. */
    static final String TARGET_PACKAGE = "net.kckern.daylight.portal";
    static final String TARGET_RECEIVER = "net.kckern.daylight.cap.lockdown.shell.DaylightAdminReceiver";
    static final String TARGET = TARGET_PACKAGE + "/" + TARGET_RECEIVER;
    /** DevicePolicyManager.transferOwnership was added in API 28. */
    static final int MIN_SDK = 28;

    /**
     * Everything KioskPolicy.enforce() applies, in the order it is undone.
     * Home and lock task go first so the kiosk boundary opens before the
     * smaller restrictions; un-hiding packages goes last.
     */
    static final String[] RELEASE_STEPS = {
        "persistent-home",        // clearPackagePersistentPreferredActivities(admin, Fully)
        "lock-task-packages",     // setLockTaskPackages(admin, {})
        "lock-task-features",     // setLockTaskFeatures(admin, platform default)
        "status-bar",             // setStatusBarDisabled(admin, false)
        "keyguard",               // setKeyguardDisabled(admin, false)
        "uninstall-block",        // setUninstallBlocked(admin, Fully, false)
        "user-restrictions",      // clearUserRestriction x4
        "organization-name",      // setOrganizationName(admin, null)
        "hidden-packages",        // setApplicationHidden(admin, pkg, false) x4
    };

    interface Device {
        int sdk();
        boolean isOwner();
        /** Stop the periodic enforcement from putting policy back; must persist. */
        void holdEnforcement() throws Exception;
        /** Undo one named step from {@link #RELEASE_STEPS}. */
        void release(String step) throws Exception;
        /** DevicePolicyManager.transferOwnership(admin, target, null). */
        void transfer(String target) throws Exception;
    }

    static final class Result {
        boolean ok;
        int http = 200;
        String error, exception, message, note;
        String target;
        boolean policyReleased, transferred;
        final List<String> released = new ArrayList<>();
        final List<String> releaseFailures = new ArrayList<>();
    }

    private OwnerTransfer() { }

    static Result run(Device device, String to) {
        Result r = new Result();
        r.target = to;
        if (!TARGET.equals(to)) {
            return refuse(r, 400, "target-not-allowed", "Ownership may only move to " + TARGET + "; nothing was changed.");
        }
        if (device.sdk() < MIN_SDK) {
            return refuse(r, 409, "api-28-required", "transferOwnership needs Android API 28; this device reports "
                    + device.sdk() + ". Nothing was changed.");
        }
        if (!device.isOwner()) {
            return refuse(r, 409, "not-device-owner", "This app is not the device owner, so it has nothing to transfer. Nothing was changed.");
        }
        try {
            device.holdEnforcement();
        } catch (Exception e) {
            describe(r, e);
            return refuse(r, 500, "hold-failed", "Could not stop policy enforcement, so nothing was released or transferred.");
        }
        for (String step : RELEASE_STEPS) {
            try { device.release(step); r.released.add(step); }
            catch (Exception e) { r.releaseFailures.add(step + ": " + e.getClass().getName() + ": " + e.getMessage()); }
        }
        r.policyReleased = r.releaseFailures.isEmpty();
        if (!r.policyReleased) {
            return refuse(r, 500, "release-incomplete", "Some policy could not be released, so ownership was NOT transferred. "
                    + "The steps listed in released are already undone and enforcement stays held; "
                    + "nothing is re-applied until POST /owner/resume-policy.");
        }
        try {
            device.transfer(to);
        } catch (Exception e) {
            describe(r, e);
            return refuse(r, 500, "transfer-failed", "transferOwnership threw. This app's kiosk policy was already released "
                    + "and is NOT re-applied; this app is still device owner with enforcement held. "
                    + "Re-arm it with POST /owner/resume-policy.");
        }
        r.ok = true;
        r.transferred = true;
        r.note = "Policy released, then ownership transferred. This app no longer holds device-owner authority.";
        return r;
    }

    private static void describe(Result r, Exception e) {
        r.exception = e.getClass().getName();
        r.message = e.getMessage();
    }

    private static Result refuse(Result r, int http, String error, String note) {
        r.ok = false; r.http = http; r.error = error; r.note = note;
        return r;
    }
}
