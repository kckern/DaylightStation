package net.kckern.daylight.cap.lockdown;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

/**
 * A device's policy state as DevicePolicyManager would hold it for one owner, with a
 * record of every call. {@link #state()} is the whole of it as text, so "apply then
 * release leaves the device as it was" is one comparison.
 */
class FakeDevicePolicy implements DevicePolicy {
    boolean owner = true, admin = true, adminFeature = true, lockTask;
    int sdk = 28;
    /** Makes transferOwnership throw, as the system does for a target it refuses. */
    RuntimeException transferFails;

    final List<String> calls = new ArrayList<>();
    final Set<String> preferredHome = new TreeSet<>();
    final Set<String> lockTaskPackages = new TreeSet<>();
    final Set<String> restrictions = new TreeSet<>();
    final Set<String> hidden = new TreeSet<>();
    /** A device no owner has touched: LOCK_TASK_FEATURE_GLOBAL_ACTIONS. */
    int lockTaskFeatures = 16;
    boolean keyguardDisabled, statusBarDisabled;
    String transferredTo;

    FakeDevicePolicy() { }

    /** The whole policy state as text. */
    String state() {
        return "home=" + preferredHome + " lockTask=" + lockTaskPackages + " features=" + lockTaskFeatures
                + " keyguardDisabled=" + keyguardDisabled + " statusBarDisabled=" + statusBarDisabled
                + " restrictions=" + restrictions + " hidden=" + hidden;
    }

    private void mutating(String call) {
        if (!owner) throw new SecurityException("not device owner");
        calls.add(call);
    }

    @Override public boolean adminActive() { return admin; }
    @Override public boolean isOwner() { return owner; }
    @Override public boolean adminFeature() { return adminFeature; }
    @Override public boolean lockTaskActive() { return lockTask; }
    @Override public int sdk() { return sdk; }
    @Override public void lockNow() { calls.add("lockNow"); }
    @Override public void reboot() { calls.add("reboot"); }

    @Override public void addPersistentPreferredHome(String packageName, String className) {
        mutating("addPersistentPreferredHome " + packageName + "/" + className);
        preferredHome.add(packageName + "/" + className);
    }

    @Override public void clearPersistentPreferredActivities(String packageName) {
        mutating("clearPersistentPreferredActivities " + packageName);
        preferredHome.removeIf(c -> c.startsWith(packageName + "/"));
    }

    @Override public void setLockTaskPackages(String[] packages) {
        mutating("setLockTaskPackages " + Arrays.toString(packages));
        lockTaskPackages.clear();
        lockTaskPackages.addAll(Arrays.asList(packages));
    }

    @Override public void setLockTaskFeatures(int features) {
        mutating("setLockTaskFeatures " + features);
        lockTaskFeatures = features;
    }

    @Override public void setKeyguardDisabled(boolean disabled) {
        mutating("setKeyguardDisabled " + disabled);
        keyguardDisabled = disabled;
    }

    @Override public boolean setStatusBarDisabled(boolean disabled) {
        mutating("setStatusBarDisabled " + disabled);
        statusBarDisabled = disabled;
        return true;
    }

    @Override public void addUserRestriction(String restriction) {
        mutating("addUserRestriction " + restriction);
        restrictions.add(restriction);
    }

    @Override public void clearUserRestriction(String restriction) {
        mutating("clearUserRestriction " + restriction);
        restrictions.remove(restriction);
    }

    @Override public void setApplicationHidden(String packageName, boolean hidden) {
        mutating("setApplicationHidden " + packageName + " " + hidden);
        if (hidden) this.hidden.add(packageName); else this.hidden.remove(packageName);
    }

    @Override public boolean isApplicationHidden(String packageName) { return hidden.contains(packageName); }

    @Override public void transferOwnership(String packageName, String className) {
        mutating("transferOwnership " + packageName + "/" + className);
        if (transferFails != null) throw transferFails;
        transferredTo = packageName + "/" + className;
        owner = false;
    }
}
