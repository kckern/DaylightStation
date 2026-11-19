package net.kckern.daylight.cap.lockdown;

/**
 * The device-policy calls owner mode makes, behind an interface so that what is applied
 * and what is released can be compared in a JVM test. The real one is
 * {@link AndroidDevicePolicy}. Every mutating method may throw (SecurityException when
 * this app is not the owner); the callers catch.
 */
interface DevicePolicy {
    boolean adminActive();
    boolean isOwner();
    /** False on a device that can never have a device admin or a device owner (the Shield). */
    boolean adminFeature();
    boolean lockTaskActive();
    int sdk();

    void lockNow();
    void reboot();

    /** A persistent preferred HOME activity: this component answers Home, with no chooser. */
    void addPersistentPreferredHome(String packageName, String className);
    /** Every persistent preferred activity this owner set for the package. */
    void clearPersistentPreferredActivities(String packageName);

    void setLockTaskPackages(String[] packages);
    void setLockTaskFeatures(int features);
    void setKeyguardDisabled(boolean disabled);
    /** False when the system rejected it. */
    boolean setStatusBarDisabled(boolean disabled);
    void addUserRestriction(String restriction);
    void clearUserRestriction(String restriction);
    void setApplicationHidden(String packageName, boolean hidden);
    boolean isApplicationHidden(String packageName);

    /** DevicePolicyManager.transferOwnership (API 28) to the admin component packageName/className. */
    void transferOwnership(String packageName, String className);
}
